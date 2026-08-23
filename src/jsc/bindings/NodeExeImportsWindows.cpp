#include "root.h"

#if OS(WINDOWS)

#include "NodeExeImportsWindows.h"
#include <windows.h>
#include <winternl.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/text/MakeString.h>

namespace Bun {

namespace {

// A mapped PE image whose headers are trusted only as far as the loader itself checked them.
// Every read goes through at()/cstring(), which yield memory only inside the headers or inside a
// section the loader mapped with some access, so a module with a garbage delay-load directory
// (which nothing in Windows reads at load time) cannot fault us.
class Image {
public:
    static bool open(void* base, Image& out)
    {
        auto* bytes = static_cast<BYTE*>(base);
        auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(bytes);
        if (dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew <= 0 || dos->e_lfanew > 0x1000000)
            return false;
        auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS64*>(bytes + dos->e_lfanew);
        if (nt->Signature != IMAGE_NT_SIGNATURE || nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
            return false;
        size_t sectionTableEnd = dos->e_lfanew + offsetof(IMAGE_NT_HEADERS64, OptionalHeader) + nt->FileHeader.SizeOfOptionalHeader
            + size_t(nt->FileHeader.NumberOfSections) * sizeof(IMAGE_SECTION_HEADER);
        if (sectionTableEnd > nt->OptionalHeader.SizeOfHeaders || nt->OptionalHeader.SizeOfHeaders > nt->OptionalHeader.SizeOfImage)
            return false;
        out.m_base = bytes;
        out.m_nt = nt;
        out.m_sections = IMAGE_FIRST_SECTION(nt);
        out.m_sectionCount = nt->FileHeader.NumberOfSections;
        return true;
    }

    const IMAGE_DATA_DIRECTORY* directory(unsigned index) const
    {
        if (index >= nt().OptionalHeader.NumberOfRvaAndSizes)
            return nullptr;
        const IMAGE_DATA_DIRECTORY* dir = &nt().OptionalHeader.DataDirectory[index];
        return dir->VirtualAddress && dir->Size ? dir : nullptr;
    }

    template<typename T> T* at(DWORD rva) const
    {
        return readableFrom(rva) >= sizeof(T) ? reinterpret_cast<T*>(m_base + rva) : nullptr;
    }

    // How many consecutive T are readable starting at rva.
    size_t countAvailable(DWORD rva, size_t elementSize) const { return readableFrom(rva) / elementSize; }

    const char* cstring(DWORD rva) const
    {
        size_t n = readableFrom(rva);
        auto* s = reinterpret_cast<const char*>(m_base + rva);
        return n && strnlen(s, n) < n ? s : nullptr;
    }

private:
    const IMAGE_NT_HEADERS64& nt() const { return *m_nt; }

    size_t readableFrom(DWORD rva) const
    {
        if (rva >= nt().OptionalHeader.SizeOfImage)
            return 0;
        if (rva < nt().OptionalHeader.SizeOfHeaders)
            return nt().OptionalHeader.SizeOfHeaders - rva;
        for (unsigned i = 0; i < m_sectionCount; ++i) {
            const IMAGE_SECTION_HEADER& s = m_sections[i];
            DWORD size = s.Misc.VirtualSize ? s.Misc.VirtualSize : s.SizeOfRawData;
            if (rva < s.VirtualAddress || rva - s.VirtualAddress >= size)
                continue;
            if (!(s.Characteristics & (IMAGE_SCN_MEM_READ | IMAGE_SCN_MEM_WRITE | IMAGE_SCN_MEM_EXECUTE)))
                return 0;
            if (size > nt().OptionalHeader.SizeOfImage - s.VirtualAddress)
                size = nt().OptionalHeader.SizeOfImage - s.VirtualAddress;
            return size - (rva - s.VirtualAddress);
        }
        return 0;
    }

    BYTE* m_base { nullptr };
    const IMAGE_NT_HEADERS64* m_nt { nullptr };
    const IMAGE_SECTION_HEADER* m_sections { nullptr };
    unsigned m_sectionCount { 0 };
};

static DWORD pageSize()
{
    static DWORD size = [] {
        SYSTEM_INFO info;
        GetSystemInfo(&info);
        return info.dwPageSize;
    }();
    return size;
}

// Makes one page writable for the lifetime of the object if it is not already, then restores its
// exact previous protection. Import address tables are in a read-only section once the loader has
// snapped them; a delay-load module handle is ordinarily in .data, where this does nothing.
class WritablePage {
public:
    explicit WritablePage(void* address)
        : m_page(reinterpret_cast<void*>(reinterpret_cast<uintptr_t>(address) & ~uintptr_t(pageSize() - 1)))
    {
        MEMORY_BASIC_INFORMATION info;
        if (!VirtualQuery(m_page, &info, sizeof(info)) || info.State != MEM_COMMIT) {
            m_ok = false;
            return;
        }
        constexpr DWORD writable = PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
        constexpr DWORD executable = PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
        if (info.Protect & writable)
            return;
        m_ok = VirtualProtect(m_page, pageSize(), (info.Protect & executable) ? PAGE_EXECUTE_READWRITE : PAGE_READWRITE, &m_previous);
        m_restore = m_ok;
    }
    ~WritablePage()
    {
        DWORD unused;
        if (m_restore)
            VirtualProtect(m_page, pageSize(), m_previous, &unused);
    }
    bool ok() const { return m_ok; }
    bool contains(void* address) const { return reinterpret_cast<uintptr_t>(address) - reinterpret_cast<uintptr_t>(m_page) < pageSize(); }

private:
    void* m_page;
    DWORD m_previous { 0 };
    bool m_ok { true };
    bool m_restore { false };
};

static bool isNodeExe(const char* name)
{
    return name && !_stricmp(name, "node.exe");
}

static HMODULE host()
{
    static HMODULE module = GetModuleHandleW(nullptr);
    return module;
}

// Name of the i'th import in an import name table, or null if it is by ordinal (node.lib has no
// ordinal-only exports, and node.exe's ordinals mean nothing in this executable) or malformed.
static const char* importName(const Image& image, const IMAGE_THUNK_DATA64& entry)
{
    if (IMAGE_SNAP_BY_ORDINAL64(entry.u1.Ordinal) || entry.u1.AddressOfData > MAXDWORD - offsetof(IMAGE_IMPORT_BY_NAME, Name))
        return nullptr;
    return image.cstring(DWORD(entry.u1.AddressOfData) + offsetof(IMAGE_IMPORT_BY_NAME, Name));
}

// Rewrites a regular (load-time) node.exe import address table, which the loader has already
// bound to whatever node.exe it found, to this executable's exports. Returns null on success or
// the first name this executable does not export (its slot, and only such slots, stay as bound).
static const char* rebindImportAddressTable(const Image& image, DWORD nameTableRva, DWORD addressTableRva)
{
    auto* names = image.at<const IMAGE_THUNK_DATA64>(nameTableRva);
    auto* slots = image.at<IMAGE_THUNK_DATA64>(addressTableRva);
    if (!names || !slots)
        return "<import table outside image>";
    size_t limit = std::min(image.countAvailable(nameTableRva, sizeof(*names)), image.countAvailable(addressTableRva, sizeof(*slots)));
    size_t count = 0;
    while (count < limit && names[count].u1.AddressOfData)
        ++count;
    if (count == limit)
        return "<unterminated import table>";

    const char* missing = nullptr;
    for (size_t i = 0; i < count;) {
        WritablePage page(&slots[i]);
        if (!page.ok())
            return "<VirtualProtect failed>";
        for (; i < count && page.contains(&slots[i]); ++i) {
            const char* name = importName(image, names[i]);
            FARPROC function = name ? GetProcAddress(host(), name) : nullptr;
            if (function)
                slots[i].u1.Function = reinterpret_cast<ULONGLONG>(function);
            else if (!missing)
                missing = name ? name : "<import by ordinal>";
        }
    }
    return missing;
}

// Returns null, or the first regular node.exe import of `base` this executable cannot provide.
static const char* redirectNodeExeImports(void* base)
{
    Image image;
    if (!Image::open(base, image))
        return nullptr;
    const char* missing = nullptr;

    if (const IMAGE_DATA_DIRECTORY* dir = image.directory(IMAGE_DIRECTORY_ENTRY_IMPORT)) {
        auto* imports = image.at<const IMAGE_IMPORT_DESCRIPTOR>(dir->VirtualAddress);
        size_t limit = image.countAvailable(dir->VirtualAddress, sizeof(*imports));
        for (size_t i = 0; imports && i < limit && imports[i].Name && imports[i].FirstThunk; ++i) {
            if (!isNodeExe(image.cstring(imports[i].Name)))
                continue;
            // Without a name table the bound slots cannot be traced back to names.
            const char* result = imports[i].OriginalFirstThunk
                ? rebindImportAddressTable(image, imports[i].OriginalFirstThunk, imports[i].FirstThunk)
                : "<no import name table>";
            if (result && !missing)
                missing = result;
        }
    }

    // Delay-load: only the descriptor's cached module handle is set. delayimp then resolves each
    // import on first call with GetProcAddress against this executable, exactly as it does when
    // node-gyp's hook answers dliNotePreLoadLibrary, and never calls LoadLibrary("node.exe").
    if (const IMAGE_DATA_DIRECTORY* dir = image.directory(IMAGE_DIRECTORY_ENTRY_DELAY_IMPORT)) {
        auto* delays = image.at<const IMAGE_DELAYLOAD_DESCRIPTOR>(dir->VirtualAddress);
        size_t limit = image.countAvailable(dir->VirtualAddress, sizeof(*delays));
        for (size_t i = 0; delays && i < limit && delays[i].DllNameRVA; ++i) {
            // Attributes.RvaBased == 0 is the VC6 layout with virtual addresses in these fields.
            if (!delays[i].Attributes.RvaBased || !isNodeExe(image.cstring(delays[i].DllNameRVA)))
                continue;
            auto* handle = delays[i].ModuleHandleRVA ? image.at<HMODULE>(delays[i].ModuleHandleRVA) : nullptr;
            if (!handle)
                continue;
            WritablePage page(handle);
            if (page.ok())
                InterlockedExchangePointer(reinterpret_cast<PVOID volatile*>(handle), host());
        }
    }

    return missing;
}

struct LdrDllNotificationData {
    ULONG Flags;
    const UNICODE_STRING* FullDllName;
    const UNICODE_STRING* BaseDllName;
    PVOID DllBase;
    ULONG SizeOfImage;
};
constexpr ULONG LDR_DLL_NOTIFICATION_REASON_LOADED = 1;
using LdrDllNotificationFunction = VOID(CALLBACK*)(ULONG reason, const LdrDllNotificationData*, PVOID context);
using LdrRegisterDllNotificationFunction = NTSTATUS(NTAPI*)(ULONG flags, LdrDllNotificationFunction, PVOID context, PVOID* cookie);

static thread_local NodeExeImports::Scope* t_currentScope = nullptr;

} // namespace

extern "C" bool Bun__disableAddonDllNotification();

class NodeExeImports::ScopeAccess {
public:
    static void record(Scope& scope, void* base, const UNICODE_STRING* moduleName, const char* missing)
    {
        // Past the capacity a module simply counts as not seen, and gets a second, idempotent pass
        // after LoadLibrary returns.
        if (scope.m_notifiedCount < std::size(scope.m_notified))
            scope.m_notified[scope.m_notifiedCount++] = base;
        if (!missing || scope.m_failed)
            return;
        scope.m_failed = true;
        strncpy_s(scope.m_symbol, missing, _TRUNCATE);
        if (moduleName && moduleName->Buffer)
            wcsncpy_s(scope.m_module, moduleName->Buffer, std::min<size_t>(moduleName->Length / sizeof(wchar_t), std::size(scope.m_module) - 1));
    }
};

namespace {

// Runs under the loader lock, on the thread that called LoadLibrary, after the new module's
// imports were snapped and before its DllMain: no allocation, no locks, no API that can load a
// module. GetProcAddress on the (long initialised) executable and VirtualProtect are fine here;
// delayimp does both from inside DllMain in every node-gyp addon built against Node < 18.17.
static VOID CALLBACK onDllNotification(ULONG reason, const LdrDllNotificationData* data, PVOID)
{
    NodeExeImports::Scope* scope = t_currentScope;
    if (reason != LDR_DLL_NOTIFICATION_REASON_LOADED || !scope || !data || !data->DllBase)
        return;
    NodeExeImports::ScopeAccess::record(*scope, data->DllBase, data->BaseDllName, redirectNodeExeImports(data->DllBase));
}

static bool registerDllNotification()
{
    static bool registered = [] {
        if (Bun__disableAddonDllNotification())
            return false;
        // Initialize these here rather than on first use inside the loader callback.
        host();
        pageSize();
        auto ntdll = GetModuleHandleW(L"ntdll.dll");
        auto registerNotification = ntdll ? reinterpret_cast<LdrRegisterDllNotificationFunction>(GetProcAddress(ntdll, "LdrRegisterDllNotification")) : nullptr;
        PVOID cookie = nullptr;
        return registerNotification && NT_SUCCESS(registerNotification(0, onDllNotification, nullptr, &cookie));
    }();
    return registered;
}

struct ProcessedModules {
    Lock lock;
    HashSet<void*> modules WTF_GUARDED_BY_LOCK(lock);
};
static ProcessedModules& processedModules()
{
    static NeverDestroyed<ProcessedModules> set;
    return set;
}

} // namespace

NodeExeImports::Scope::Scope()
    : m_previous(t_currentScope)
{
    registerDllNotification();
    t_currentScope = this;
}

NodeExeImports::Scope::~Scope()
{
    t_currentScope = m_previous;
}

WTF::String NodeExeImports::Scope::unresolvedImportError(HMODULE loaded)
{
    if (loaded) {
        bool notified = false;
        for (size_t i = 0; !notified && i < m_notifiedCount; ++i)
            notified = m_notified[i] == loaded;
        // A module the notification did not cover in this scope: it was already loaded (an earlier
        // dlopen, bun:ffi, a dependency of something else) or the notification is unavailable.
        // Redirect it once, here, before any of its exports are called by this dlopen.
        auto& processed = processedModules();
        Locker locker { processed.lock };
        if (processed.modules.add(loaded).isNewEntry && !notified) {
            wchar_t path[MAX_PATH];
            DWORD length = GetModuleFileNameW(loaded, path, MAX_PATH);
            const wchar_t* base = path + length;
            while (base > path && base[-1] != L'\\' && base[-1] != L'/')
                --base;
            UNICODE_STRING name { USHORT((path + length - base) * sizeof(wchar_t)), USHORT((path + length - base) * sizeof(wchar_t)), const_cast<wchar_t*>(base) };
            ScopeAccess::record(*this, loaded, length ? &name : nullptr, redirectNodeExeImports(loaded));
        }
        if (m_failed)
            processed.modules.remove(loaded);
    }
    if (!m_failed)
        return {};
    return makeString(m_module[0] ? WTF::String(m_module) : "it"_s, " imports '"_s, WTF::String::fromLatin1(m_symbol), "' from node.exe, which Bun does not provide"_s);
}

void NodeExeImports::forget(HMODULE module)
{
    auto& processed = processedModules();
    Locker locker { processed.lock };
    processed.modules.remove(module);
}

bool NodeExeImports::fileHasLoadTimeNodeExeImport(const wchar_t* path)
{
    HMODULE mapping = LoadLibraryExW(path, nullptr, LOAD_LIBRARY_AS_IMAGE_RESOURCE | LOAD_LIBRARY_AS_DATAFILE);
    if (!mapping)
        return false;
    bool found = false;
    Image image;
    // Bit 1 of the handle: mapped with image layout (sections at their RVAs), which the walk relies on.
    if ((reinterpret_cast<uintptr_t>(mapping) & 2) && Image::open(reinterpret_cast<void*>(reinterpret_cast<uintptr_t>(mapping) & ~uintptr_t(3)), image)) {
        if (const IMAGE_DATA_DIRECTORY* dir = image.directory(IMAGE_DIRECTORY_ENTRY_IMPORT)) {
            auto* imports = image.at<const IMAGE_IMPORT_DESCRIPTOR>(dir->VirtualAddress);
            size_t limit = image.countAvailable(dir->VirtualAddress, sizeof(*imports));
            for (size_t i = 0; imports && !found && i < limit && imports[i].Name && imports[i].FirstThunk; ++i)
                found = isNodeExe(image.cstring(imports[i].Name));
        }
    }
    FreeLibrary(mapping);
    return found;
}

} // namespace Bun

#endif // OS(WINDOWS)
