#include "root.h"

#if OS(DARWIN)
#include <mach/vm_types.h>
#include <mach/mach_host.h>
#include <mach/mach_init.h>
#include <mach/message.h>
#include <mach/vm_statistics.h>
#include <unistd.h>

// Adapted from libuv darwin uv_get_free_memory, MIT
extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    vm_statistics_data_t info;
    mach_msg_type_number_t count = sizeof(info) / sizeof(integer_t);

    if (host_statistics(mach_host_self(), HOST_VM_INFO, (host_info_t)&info, &count) != KERN_SUCCESS) {
        return 0;
    }
    return (uint64_t)info.free_count * sysconf(_SC_PAGESIZE);
}
#endif

#if OS(LINUX)
#include <sys/sysinfo.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

// Read a numeric field (in kB) from /proc/meminfo, matching libuv's
// uv__read_proc_meminfo. Returns the value in bytes, or 0 on failure.
static uint64_t bunReadProcMeminfo(const char* what)
{
    char buf[4096]; // Large enough to hold all of /proc/meminfo.
    int fd;
    ssize_t n = 0;
    size_t off = 0;
    bool readError = false;

    do {
        fd = open("/proc/meminfo", O_RDONLY | O_CLOEXEC);
    } while (fd == -1 && errno == EINTR);
    if (fd == -1) {
        return 0;
    }

    while (off < sizeof(buf) - 1) {
        do {
            n = read(fd, buf + off, sizeof(buf) - 1 - off);
        } while (n == -1 && errno == EINTR);
        if (n == 0) {
            break; // EOF
        }
        if (n < 0) {
            readError = true;
            break;
        }
        off += static_cast<size_t>(n);
    }
    close(fd);

    if (readError) {
        return 0;
    }
    buf[off] = '\0';

    const char* p = strstr(buf, what);
    if (p == nullptr) {
        return 0;
    }
    p += strlen(what);

    uint64_t rc = 0;
    if (sscanf(p, "%" SCNu64 " kB", &rc) != 1) {
        return 0;
    }
    return rc * 1024;
}

// Matches libuv's uv_get_free_memory (src/unix/linux.c): prefer
// MemAvailable from /proc/meminfo (kernel's estimate of memory available for
// new allocations, including reclaimable page cache) and only fall back to
// sysinfo.freeram (which excludes page cache) when /proc/meminfo cannot be
// read. This matches Node.js's os.freemem() behaviour.
extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    uint64_t rc = bunReadProcMeminfo("MemAvailable:");
    if (rc != 0) {
        return rc;
    }

    struct sysinfo info;
    if (sysinfo(&info) == 0) {
        return static_cast<uint64_t>(info.freeram) * info.mem_unit;
    }
    return 0;
}
#endif

#if OS(WINDOWS)
#include "OsBinding.h"
#include "BunWindowsProcess.h"
#include <uv/errno.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include "BunWinternl.h"
#include <wtf/FastMalloc.h>

extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    MEMORYSTATUSEX status;
    status.dwLength = sizeof(status);
    if (!GlobalMemoryStatusEx(&status))
        return 0;
    return status.ullAvailPhys;
}

// UTF-8 length of `length` UTF-16 code units, excluding any terminator.
static size_t utf8Length(const WCHAR* string, int length)
{
    if (length == 0)
        return 0;
    return static_cast<size_t>(WideCharToMultiByte(CP_UTF8, 0, string, length, nullptr, 0, nullptr, nullptr));
}

// Writes `length` UTF-16 code units as NUL-terminated UTF-8 and returns the
// number of bytes written, terminator included. `capacity` is at least 1.
static size_t writeUTF8(const WCHAR* string, int length, char* out, size_t capacity)
{
    // Given a size of 0, WideCharToMultiByte writes nothing and returns the size needed.
    int room = static_cast<int>(capacity - 1);
    int written = length == 0 || room == 0 ? 0 : WideCharToMultiByte(CP_UTF8, 0, string, length, out, room, nullptr, nullptr);
    out[written] = '\0';
    return static_cast<size_t>(written) + 1;
}

// Port of libuv's uv_cpu_info() (src/win/util.c), MIT.
extern "C" int Bun__Os__cpuInfo(BunCpuInfo** cpuInfos, int* count)
{
    *cpuInfos = nullptr;
    *count = 0;

    // Logical processors of this process's processor group.
    SYSTEM_INFO systemInfo;
    GetSystemInfo(&systemInfo);
    DWORD cpuCount = systemInfo.dwNumberOfProcessors;

    // ProcessorNameString is at most 256 WCHARs; a UTF-16 code unit is at most 3 UTF-8 bytes.
    static constexpr size_t maxBrand = 256;
    static constexpr size_t modelCapacity = maxBrand * 3 + 1;

    void* allocation = nullptr;
    size_t performanceSize = cpuCount * sizeof(SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION);
    if (!WTF::tryFastMalloc(cpuCount * (sizeof(BunCpuInfo) + modelCapacity) + performanceSize).getValue(allocation))
        return UV__ENOMEM;

    // The model strings go last: their size is odd, and NtQuerySystemInformation
    // fails with STATUS_DATATYPE_MISALIGNMENT for a buffer that is not aligned.
    auto* infos = static_cast<BunCpuInfo*>(allocation);
    auto* performance = reinterpret_cast<SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION*>(infos + cpuCount);
    char* models = reinterpret_cast<char*>(performance + cpuCount);
    static_assert(alignof(BunCpuInfo) >= alignof(SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION));

    DWORD error;
    ULONG resultSize;
    NTSTATUS status = NtQuerySystemInformation(SystemProcessorPerformanceInformation, performance, static_cast<ULONG>(performanceSize), &resultSize);
    if (!NT_SUCCESS(status)) {
        error = RtlNtStatusToDosError(status);
        goto fail;
    }
    ASSERT(resultSize == performanceSize);

    for (DWORD i = 0; i < cpuCount; i++) {
        WCHAR keyName[128];
        _snwprintf(keyName, std::size(keyName), L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\%lu", i);

        HKEY processorKey;
        error = RegOpenKeyExW(HKEY_LOCAL_MACHINE, keyName, 0, KEY_QUERY_VALUE, &processorKey);
        if (error != ERROR_SUCCESS)
            goto fail;

        // A value shorter than a DWORD leaves the rest of `speed` unwritten.
        DWORD speed = 0;
        DWORD speedSize = sizeof(speed);
        error = RegQueryValueExW(processorKey, L"~MHz", nullptr, nullptr, reinterpret_cast<BYTE*>(&speed), &speedSize);
        if (error != ERROR_SUCCESS) {
            RegCloseKey(processorKey);
            goto fail;
        }

        WCHAR brand[maxBrand];
        DWORD brandSize = sizeof(brand);
        error = RegQueryValueExW(processorKey, L"ProcessorNameString", nullptr, nullptr, reinterpret_cast<BYTE*>(brand), &brandSize);
        RegCloseKey(processorKey);
        // Without the value the model is empty.
        if (error == ERROR_FILE_NOT_FOUND)
            brandSize = 0;
        else if (error != ERROR_SUCCESS)
            goto fail;

        BunCpuInfo& info = infos[i];
        info.model = models + i * modelCapacity;
        // Untrimmed: the registry value is padded with trailing spaces on some CPUs and Node reports them.
        writeUTF8(brand, static_cast<int>(wcsnlen(brand, brandSize / sizeof(WCHAR))), info.model, modelCapacity);
        info.speed = static_cast<int>(speed);
        // 100ns units to milliseconds. KernelTime includes IdleTime.
        info.cpu_times.user = performance[i].UserTime.QuadPart / 10000;
        info.cpu_times.nice = 0;
        info.cpu_times.sys = (performance[i].KernelTime.QuadPart - performance[i].IdleTime.QuadPart) / 10000;
        info.cpu_times.idle = performance[i].IdleTime.QuadPart / 10000;
        // winternl.h names DpcTime and InterruptTime "Reserved1".
        info.cpu_times.irq = performance[i].Reserved1[1].QuadPart / 10000;
    }

    *cpuInfos = infos;
    *count = static_cast<int>(cpuCount);
    return 0;

fail:
    WTF::fastFree(allocation);
    return Bun__translateWin32ErrorToUV(error);
}

extern "C" void Bun__Os__freeCpuInfo(BunCpuInfo* cpuInfos, int)
{
    WTF::fastFree(cpuInfos);
}

static bool isReported(const IP_ADAPTER_ADDRESSES* adapter)
{
    return adapter->OperStatus == IfOperStatusUp && adapter->FirstUnicastAddress;
}

// Port of libuv's uv_interface_addresses() (src/win/util.c), MIT.
extern "C" int Bun__Os__interfaceAddresses(BunInterfaceAddress** addresses, int* count)
{
    *addresses = nullptr;
    *count = 0;

    ULONG adaptersSize = 0;
    IP_ADAPTER_ADDRESSES* adapters = nullptr;
    for (;;) {
        ULONG result = GetAdaptersAddresses(AF_UNSPEC, GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER, nullptr, adapters, &adaptersSize);
        if (result == ERROR_SUCCESS)
            break;

        WTF::fastFree(adapters);
        adapters = nullptr;

        switch (result) {
        case ERROR_BUFFER_OVERFLOW: {
            void* allocation;
            if (!WTF::tryFastMalloc(adaptersSize).getValue(allocation))
                return UV__ENOMEM;
            adapters = static_cast<IP_ADAPTER_ADDRESSES*>(allocation);
            continue;
        }
        case ERROR_NO_DATA:
            // No adapters.
            return 0;
        case ERROR_ADDRESS_NOT_ASSOCIATED:
            return UV__EAGAIN;
        case ERROR_INVALID_PARAMETER:
            // The arguments are valid, which leaves "the address information is greater than ULONG_MAX".
            return UV__ENOBUFS;
        default:
            return Bun__translateWin32ErrorToUV(result);
        }
    }

    // One entry per unicast address of every adapter that is up, followed by the adapter names.
    size_t addressCount = 0;
    size_t namesSize = 0;
    for (auto* adapter = adapters; adapter; adapter = adapter->Next) {
        if (!isReported(adapter))
            continue;
        namesSize += utf8Length(adapter->FriendlyName, static_cast<int>(wcslen(adapter->FriendlyName))) + 1;
        for (auto* unicast = adapter->FirstUnicastAddress; unicast; unicast = unicast->Next)
            addressCount++;
    }

    void* allocation = nullptr;
    // Never zero bytes: the caller frees a non-null array.
    if (!WTF::tryFastMalloc(addressCount * sizeof(BunInterfaceAddress) + namesSize + 1).getValue(allocation)) {
        WTF::fastFree(adapters);
        return UV__ENOMEM;
    }

    auto* address = static_cast<BunInterfaceAddress*>(allocation);
    char* name = reinterpret_cast<char*>(address + addressCount);
    char* namesEnd = name + namesSize + 1;

    for (auto* adapter = adapters; adapter; adapter = adapter->Next) {
        if (!isReported(adapter))
            continue;

        size_t nameSize = writeUTF8(adapter->FriendlyName, static_cast<int>(wcslen(adapter->FriendlyName)), name, static_cast<size_t>(namesEnd - name));

        for (auto* unicast = adapter->FirstUnicastAddress; unicast; unicast = unicast->Next) {
            const sockaddr* socketAddress = unicast->Address.lpSockaddr;
            // An illegal length is reported as 255; the mask has room for the bits of the address.
            const ULONG addressBits = socketAddress->sa_family == AF_INET6 ? 128 : 32;
            const ULONG prefixLength = std::min<ULONG>(unicast->OnLinkPrefixLength, addressBits);

            memset(address, 0, sizeof(*address));
            address->name = name;

            if (adapter->PhysicalAddressLength == sizeof(address->phys_addr))
                memcpy(address->phys_addr, adapter->PhysicalAddress, sizeof(address->phys_addr));

            address->is_internal = adapter->IfType == IF_TYPE_SOFTWARE_LOOPBACK;

            if (socketAddress->sa_family == AF_INET6) {
                address->address.address6 = *reinterpret_cast<const sockaddr_in6*>(socketAddress);
                address->netmask.netmask6.sin6_family = AF_INET6;
                memset(address->netmask.netmask6.sin6_addr.s6_addr, 0xff, prefixLength >> 3);
                if (prefixLength % 8)
                    address->netmask.netmask6.sin6_addr.s6_addr[prefixLength >> 3] = static_cast<UCHAR>(0xff << (8 - prefixLength % 8));
            } else {
                address->address.address4 = *reinterpret_cast<const sockaddr_in*>(socketAddress);
                address->netmask.netmask4.sin_family = AF_INET;
                address->netmask.netmask4.sin_addr.s_addr = prefixLength > 0 ? htonl(0xffffffff << (32 - prefixLength)) : 0;
            }

            address++;
        }

        name += nameSize;
    }

    WTF::fastFree(adapters);

    *addresses = static_cast<BunInterfaceAddress*>(allocation);
    *count = static_cast<int>(addressCount);
    return 0;
}

extern "C" void Bun__Os__freeInterfaceAddresses(BunInterfaceAddress* addresses, int)
{
    WTF::fastFree(addresses);
}
#endif

#if OS(FREEBSD)
#include <sys/types.h>
#include <sys/sysctl.h>
#include <unistd.h>

// Matches libuv's uv_get_free_memory for FreeBSD: free pages × pagesize.
extern "C" uint64_t Bun__Os__getFreeMemory(void)
{
    int free_pages = 0;
    size_t len = sizeof(free_pages);
    if (sysctlbyname("vm.stats.vm.v_free_count", &free_pages, &len, nullptr, 0) != 0) {
        return 0;
    }
    return static_cast<uint64_t>(free_pages) * sysconf(_SC_PAGESIZE);
}
#endif
