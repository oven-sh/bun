// This file is from Electron's fork of rescle
// https://github.com/electron/rcedit/blob/e36b688b42df0e236922019ce14e0ea165dc176d/src/rescle.cc
// 'bun build --compile' uses this on Windows to allow
// patching the icon of the generated executable.
//
// Copyright (c) 2013 GitHub Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// Copyright (c) 2013 GitHub, Inc. All rights reserved.
// Use of this source code is governed by MIT license that can be found in the
// LICENSE file.
//
// This file is modified from Rescle written by yoshio.okumura@gmail.com:
// http://code.google.com/p/rescle/
#include "rescle.h"

#include <assert.h>
#include <atlstr.h>
#include <sstream> // wstringstream
#include <iomanip> // setw, setfill
#include <fstream>
#include <codecvt>
#include <algorithm>

namespace rescle {

namespace {

#pragma pack(push, 2)
typedef struct _GRPICONENTRY {
    BYTE width;
    BYTE height;
    BYTE colourCount;
    BYTE reserved;
    BYTE planes;
    BYTE bitCount;
    WORD bytesInRes;
    WORD bytesInRes2;
    WORD reserved2;
    WORD id;
} GRPICONENTRY;
#pragma pack(pop)

#pragma pack(push, 2)
typedef struct _GRPICONHEADER {
    WORD reserved;
    WORD type;
    WORD count;
    GRPICONENTRY entries[1];
} GRPICONHEADER;
#pragma pack(pop)

#pragma pack(push, 1)
typedef struct _VS_VERSION_HEADER {
    WORD wLength;
    WORD wValueLength;
    WORD wType;
} VS_VERSION_HEADER;
#pragma pack(pop)

#pragma pack(push, 1)
typedef struct _VS_VERSION_STRING {
    VS_VERSION_HEADER Header;
    WCHAR szKey[1];
} VS_VERSION_STRING;
#pragma pack(pop)

#pragma pack(push, 1)
typedef struct _VS_VERSION_ROOT_INFO {
    WCHAR szKey[16];
    WORD Padding1[1];
    VS_FIXEDFILEINFO Info;
} VS_VERSION_ROOT_INFO;
#pragma pack(pop)

#pragma pack(push, 1)
typedef struct _VS_VERSION_ROOT {
    VS_VERSION_HEADER Header;
    VS_VERSION_ROOT_INFO Info;
} VS_VERSION_ROOT;
#pragma pack(pop)

// The default en-us LANGID.
LANGID kLangEnUs = 1033;
LANGID kCodePageEnUs = 1200;
UINT kDefaultIconBundle = 0;

template<typename T>
inline T round(T value, int modula = 4)
{
    return value + ((value % modula > 0) ? (modula - value % modula) : 0);
}

std::wstring ReadFileToString(const wchar_t* filename)
{
    std::wifstream wif(filename);
    wif.imbue(std::locale(std::locale::empty(), new std::codecvt_utf8<wchar_t>));
    std::wstringstream wss;
    wss << wif.rdbuf();
    return wss.str();
}

class ScopedFile {
public:
    ScopedFile(const WCHAR* path)
        : file_(CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL))
    {
    }
    ~ScopedFile() { CloseHandle(file_); }

    operator HANDLE() { return file_; }

private:
    HANDLE file_;
};

struct VersionStampValue {
    WORD valueLength = 0; // stringfileinfo, stringtable: 0; string: Value size in WORD; var: Value size in bytes
    WORD type = 0; // 0: binary data; 1: text data
    std::wstring key; // stringtable: 8-digit hex stored as UTF-16 (hiword: hi6: sublang, lo10: majorlang; loword: code page); must include zero words to align next member on 32-bit boundary
    std::vector<BYTE> value; // string: zero-terminated string; var: array of language & code page ID pairs
    std::vector<VersionStampValue> children;

    size_t GetLength() const;
    std::vector<BYTE> Serialize() const;
};

} // namespace

VersionInfo::VersionInfo()
{
    FillDefaultData();
}

VersionInfo::VersionInfo(HMODULE hModule, WORD languageId)
{
    HRSRC hRsrc = FindResourceExW(hModule, RT_VERSION, MAKEINTRESOURCEW(1), languageId);

    if (hRsrc == NULL) {
        throw std::system_error(GetLastError(), std::system_category());
    }

    HGLOBAL hGlobal = LoadResource(hModule, hRsrc);
    if (hGlobal == NULL) {
        throw std::system_error(GetLastError(), std::system_category());
    }

    void* p = LockResource(hGlobal);
    if (p == NULL) {
        throw std::system_error(GetLastError(), std::system_category());
    }

    DWORD size = SizeofResource(hModule, hRsrc);
    if (size == 0) {
        throw std::system_error(GetLastError(), std::system_category());
    }

    DeserializeVersionInfo(static_cast<BYTE*>(p), size);
    FillDefaultData();
}

bool VersionInfo::HasFixedFileInfo() const
{
    return fixedFileInfo_.dwSignature == 0xFEEF04BD;
}

VS_FIXEDFILEINFO& VersionInfo::GetFixedFileInfo()
{
    return fixedFileInfo_;
}

const VS_FIXEDFILEINFO& VersionInfo::GetFixedFileInfo() const
{
    return fixedFileInfo_;
}

void VersionInfo::SetFixedFileInfo(const VS_FIXEDFILEINFO& value)
{
    fixedFileInfo_ = value;
}

std::vector<BYTE> VersionInfo::Serialize() const
{
    VersionStampValue versionInfo;
    versionInfo.key = L"VS_VERSION_INFO";
    versionInfo.type = 0;

    if (HasFixedFileInfo()) {
        auto size = sizeof(VS_FIXEDFILEINFO);
        versionInfo.valueLength = size;

        auto& dst = versionInfo.value;
        dst.resize(size);

        memcpy(&dst[0], &GetFixedFileInfo(), size);
    }

    {
        VersionStampValue stringFileInfo;
        stringFileInfo.key = L"StringFileInfo";
        stringFileInfo.type = 1;
        stringFileInfo.valueLength = 0;

        for (const auto& iTable : stringTables) {
            VersionStampValue stringTableRaw;
            stringTableRaw.type = 1;
            stringTableRaw.valueLength = 0;

            {
                auto& translate = iTable.encoding;
                std::wstringstream ss;
                ss << std::hex << std::setw(8) << std::setfill(L'0') << (translate.wLanguage << 16 | translate.wCodePage);
                stringTableRaw.key = ss.str();
            }

            for (const auto& iString : iTable.strings) {
                const auto& stringValue = iString.second;
                auto strLenNullTerminated = stringValue.length() + 1;

                VersionStampValue stringRaw;
                stringRaw.type = 1;
                stringRaw.key = iString.first;
                stringRaw.valueLength = strLenNullTerminated;

                auto size = strLenNullTerminated * sizeof(WCHAR);
                auto& dst = stringRaw.value;
                dst.resize(size);

                auto src = stringValue.c_str();

                memcpy(&dst[0], src, size);

                stringTableRaw.children.push_back(std::move(stringRaw));
            }

            stringFileInfo.children.push_back(std::move(stringTableRaw));
        }

        versionInfo.children.push_back(std::move(stringFileInfo));
    }

    {
        VersionStampValue varFileInfo;
        varFileInfo.key = L"VarFileInfo";
        varFileInfo.type = 1;
        varFileInfo.valueLength = 0;

        {
            VersionStampValue varRaw;
            varRaw.key = L"Translation";
            varRaw.type = 0;

            {
                auto newValueSize = sizeof(DWORD);
                auto& dst = varRaw.value;
                dst.resize(supportedTranslations.size() * newValueSize);

                for (auto iVar = 0; iVar < supportedTranslations.size(); ++iVar) {
                    auto& translate = supportedTranslations[iVar];
                    auto var = DWORD(translate.wCodePage) << 16 | translate.wLanguage;
                    memcpy(&dst[iVar * newValueSize], &var, newValueSize);
                }

                varRaw.valueLength = varRaw.value.size();
            }

            varFileInfo.children.push_back(std::move(varRaw));
        }

        versionInfo.children.push_back(std::move(varFileInfo));
    }

    return std::move(versionInfo.Serialize());
}

void VersionInfo::FillDefaultData()
{
    if (stringTables.empty()) {
        Translate enUsTranslate = { kLangEnUs, kCodePageEnUs };
        stringTables.push_back({ enUsTranslate });
        supportedTranslations.push_back(enUsTranslate);
    }
    if (!HasFixedFileInfo()) {
        fixedFileInfo_ = { 0 };
        fixedFileInfo_.dwSignature = 0xFEEF04BD;
        fixedFileInfo_.dwFileType = VFT_APP;
    }
}

void VersionInfo::DeserializeVersionInfo(const BYTE* pData, size_t size)
{
    auto pVersionInfo = reinterpret_cast<const VS_VERSION_ROOT*>(pData);
    WORD fixedFileInfoSize = pVersionInfo->Header.wValueLength;

    if (fixedFileInfoSize > 0)
        SetFixedFileInfo(pVersionInfo->Info.Info);

    const BYTE* fixedFileInfoEndOffset = reinterpret_cast<const BYTE*>(&pVersionInfo->Info.szKey) + (wcslen(pVersionInfo->Info.szKey) + 1) * sizeof(WCHAR) + fixedFileInfoSize;
    const BYTE* pVersionInfoChildren = reinterpret_cast<const BYTE*>(round(reinterpret_cast<ptrdiff_t>(fixedFileInfoEndOffset)));
    size_t versionInfoChildrenOffset = pVersionInfoChildren - pData;
    size_t versionInfoChildrenSize = pVersionInfo->Header.wLength - versionInfoChildrenOffset;

    const auto childrenEndOffset = pVersionInfoChildren + versionInfoChildrenSize;
    const auto resourceEndOffset = pData + size;
    for (auto p = pVersionInfoChildren; p < childrenEndOffset && p < resourceEndOffset;) {
        auto pKey = reinterpret_cast<const VS_VERSION_STRING*>(p)->szKey;
        auto versionInfoChildData = GetChildrenData(p);
        if (wcscmp(pKey, L"StringFileInfo") == 0) {
            DeserializeVersionStringFileInfo(versionInfoChildData.first, versionInfoChildData.second, stringTables);
        } else if (wcscmp(pKey, L"VarFileInfo") == 0) {
            DeserializeVarFileInfo(versionInfoChildData.first, supportedTranslations);
        }

        p += round(reinterpret_cast<const VS_VERSION_STRING*>(p)->Header.wLength);
    }
}

VersionStringTable VersionInfo::DeserializeVersionStringTable(const BYTE* tableData)
{
    auto strings = GetChildrenData(tableData);
    auto stringTable = reinterpret_cast<const VS_VERSION_STRING*>(tableData);
    auto end_ptr = const_cast<WCHAR*>(stringTable->szKey + (8 * sizeof(WCHAR)));
    auto langIdCodePagePair = static_cast<DWORD>(wcstol(stringTable->szKey, &end_ptr, 16));

    VersionStringTable tableEntry;

    // unicode string of 8 hex digits
    tableEntry.encoding.wLanguage = langIdCodePagePair >> 16;
    tableEntry.encoding.wCodePage = langIdCodePagePair;

    for (auto posStrings = 0U; posStrings < strings.second;) {
        const auto stringEntry = reinterpret_cast<const VS_VERSION_STRING* const>(strings.first + posStrings);
        const auto stringData = GetChildrenData(strings.first + posStrings);
        tableEntry.strings.push_back(std::pair<std::wstring, std::wstring>(stringEntry->szKey, std::wstring(reinterpret_cast<const WCHAR* const>(stringData.first), stringEntry->Header.wValueLength)));

        posStrings += round(stringEntry->Header.wLength);
    }

    return tableEntry;
}

void VersionInfo::DeserializeVersionStringFileInfo(const BYTE* offset, size_t length, std::vector<VersionStringTable>& stringTables)
{
    for (auto posStringTables = 0U; posStringTables < length;) {
        auto stringTableEntry = DeserializeVersionStringTable(offset + posStringTables);
        stringTables.push_back(stringTableEntry);
        posStringTables += round(reinterpret_cast<const VS_VERSION_STRING*>(offset + posStringTables)->Header.wLength);
    }
}

void VersionInfo::DeserializeVarFileInfo(const unsigned char* offset, std::vector<Translate>& translations)
{
    const auto translatePairs = GetChildrenData(offset);

    const auto top = reinterpret_cast<const DWORD* const>(translatePairs.first);
    for (auto pTranslatePair = top; pTranslatePair < top + translatePairs.second; pTranslatePair += sizeof(DWORD)) {
        auto codePageLangIdPair = *pTranslatePair;
        Translate translate;
        translate.wLanguage = codePageLangIdPair;
        translate.wCodePage = codePageLangIdPair >> 16;
        translations.push_back(translate);
    }
}

OffsetLengthPair VersionInfo::GetChildrenData(const BYTE* entryData)
{
    auto entry = reinterpret_cast<const VS_VERSION_STRING*>(entryData);
    auto headerOffset = entryData;
    auto headerSize = sizeof(VS_VERSION_HEADER);
    auto keySize = (wcslen(entry->szKey) + 1) * sizeof(WCHAR);
    auto childrenOffset = round(headerSize + keySize);

    auto pChildren = headerOffset + childrenOffset;
    auto childrenSize = entry->Header.wLength - childrenOffset;
    return OffsetLengthPair(pChildren, childrenSize);
}

size_t VersionStampValue::GetLength() const
{
    size_t bytes = sizeof(VS_VERSION_HEADER);
    bytes += static_cast<size_t>(key.length() + 1) * sizeof(WCHAR);
    if (!value.empty())
        bytes = round(bytes) + value.size();
    for (const auto& child : children)
        bytes = round(bytes) + static_cast<size_t>(child.GetLength());
    return bytes;
}

std::vector<BYTE> VersionStampValue::Serialize() const
{
    std::vector<BYTE> data = std::vector<BYTE>(GetLength());

    size_t offset = 0;

    VS_VERSION_HEADER header = { static_cast<WORD>(data.size()), valueLength, type };
    memcpy(&data[offset], &header, sizeof(header));
    offset += sizeof(header);

    auto keySize = static_cast<size_t>(key.length() + 1) * sizeof(WCHAR);
    memcpy(&data[offset], key.c_str(), keySize);
    offset += keySize;

    if (!value.empty()) {
        offset = round(offset);
        memcpy(&data[offset], &value[0], value.size());
        offset += value.size();
    }

    for (const auto& child : children) {
        offset = round(offset);
        size_t childLength = child.GetLength();
        std::vector<BYTE> src = child.Serialize();
        memcpy(&data[offset], &src[0], childLength);
        offset += childLength;
    }

    return std::move(data);
}

ResourceUpdater::ResourceUpdater()
    : module_(NULL)
{
}

ResourceUpdater::~ResourceUpdater()
{
    if (module_ != NULL) {
        FreeLibrary(module_);
        module_ = NULL;
    }
}

bool ResourceUpdater::Load(const WCHAR* filename)
{
    wchar_t abspath[MAX_PATH] = { 0 };
    if (_wfullpath(abspath, filename, MAX_PATH))
        module_ = LoadLibraryExW(abspath, NULL, DONT_RESOLVE_DLL_REFERENCES | LOAD_LIBRARY_AS_DATAFILE);
    else
        module_ = LoadLibraryExW(filename, NULL, DONT_RESOLVE_DLL_REFERENCES | LOAD_LIBRARY_AS_DATAFILE);

    if (module_ == NULL) {
        return false;
    }

    this->filename_ = filename;

    EnumResourceNamesW(module_, RT_STRING, OnEnumResourceName, reinterpret_cast<LONG_PTR>(this));
    EnumResourceNamesW(module_, RT_VERSION, OnEnumResourceName, reinterpret_cast<LONG_PTR>(this));
    EnumResourceNamesW(module_, RT_GROUP_ICON, OnEnumResourceName, reinterpret_cast<LONG_PTR>(this));
    EnumResourceNamesW(module_, RT_ICON, OnEnumResourceName, reinterpret_cast<LONG_PTR>(this));
    EnumResourceNamesW(module_, RT_MANIFEST, OnEnumResourceManifest, reinterpret_cast<LONG_PTR>(this));
    EnumResourceNamesW(module_, RT_RCDATA, OnEnumResourceName, reinterpret_cast<LONG_PTR>(this));

    return true;
}

bool ResourceUpdater::SetExecutionLevel(const WCHAR* value)
{
    executionLevel_ = value;
    return true;
}

bool ResourceUpdater::IsExecutionLevelSet()
{
    return !executionLevel_.empty();
}

bool ResourceUpdater::SetApplicationManifest(const WCHAR* value)
{
    applicationManifestPath_ = value;
    return true;
}

bool ResourceUpdater::IsApplicationManifestSet()
{
    return !applicationManifestPath_.empty();
}

bool ResourceUpdater::SetVersionString(WORD languageId, const WCHAR* name, const WCHAR* value)
{
    std::wstring nameStr(name);
    std::wstring valueStr(value);

    auto& stringTables = versionStampMap_[languageId].stringTables;
    for (auto j = stringTables.begin(); j != stringTables.end(); ++j) {
        auto& stringPairs = j->strings;
        for (auto k = stringPairs.begin(); k != stringPairs.end(); ++k) {
            if (k->first == nameStr) {
                k->second = valueStr;
                return true;
            }
        }

        // Not found, append one for all tables.
        stringPairs.push_back(VersionString(nameStr, valueStr));
    }

    return true;
}

bool ResourceUpdater::SetVersionString(const WCHAR* name, const WCHAR* value)
{
    LANGID langId = versionStampMap_.empty() ? kLangEnUs
                                             : versionStampMap_.begin()->first;
    return SetVersionString(langId, name, value);
}

const WCHAR* ResourceUpdater::GetVersionString(WORD languageId, const WCHAR* name)
{
    std::wstring nameStr(name);

    const auto& stringTables = versionStampMap_[languageId].stringTables;
    for (const auto& j : stringTables) {
        const auto& stringPairs = j.strings;
        for (const auto& k : stringPairs) {
            if (k.first == nameStr) {
                return k.second.c_str();
            }
        }
    }

    return NULL;
}

const WCHAR* ResourceUpdater::GetVersionString(const WCHAR* name)
{
    if (versionStampMap_.empty()) {
        return NULL;
    } else {
        return GetVersionString(versionStampMap_.begin()->first, name);
    }
}

bool ResourceUpdater::SetProductVersion(WORD languageId, UINT id, unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4)
{
    VersionInfo& versionInfo = versionStampMap_[languageId];
    if (!versionInfo.HasFixedFileInfo()) {
        return false;
    }

    VS_FIXEDFILEINFO& root = versionInfo.GetFixedFileInfo();

    root.dwProductVersionMS = v1 << 16 | v2;
    root.dwProductVersionLS = v3 << 16 | v4;

    return true;
}

bool ResourceUpdater::SetProductVersion(unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4)
{
    LANGID langId = versionStampMap_.empty() ? kLangEnUs
                                             : versionStampMap_.begin()->first;
    return SetProductVersion(langId, 1, v1, v2, v3, v4);
}

bool ResourceUpdater::SetFileVersion(WORD languageId, UINT id, unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4)
{
    VersionInfo& versionInfo = versionStampMap_[languageId];
    if (!versionInfo.HasFixedFileInfo()) {
        return false;
    }

    VS_FIXEDFILEINFO& root = versionInfo.GetFixedFileInfo();

    root.dwFileVersionMS = v1 << 16 | v2;
    root.dwFileVersionLS = v3 << 16 | v4;
    return true;
}

bool ResourceUpdater::SetFileVersion(unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4)
{
    LANGID langId = versionStampMap_.empty() ? kLangEnUs
                                             : versionStampMap_.begin()->first;
    return SetFileVersion(langId, 1, v1, v2, v3, v4);
}

bool ResourceUpdater::ChangeString(WORD languageId, UINT id, const WCHAR* value)
{
    StringTable& table = stringTableMap_[languageId];

    UINT blockId = id / 16;
    if (table.find(blockId) == table.end()) {
        // Fill the table until we reach the block.
        for (size_t i = table.size(); i <= blockId; ++i) {
            table[i] = std::vector<std::wstring>(16);
        }
    }

    assert(table[blockId].size() == 16);
    UINT blockIndex = id % 16;
    table[blockId][blockIndex] = value;

    return true;
}

bool ResourceUpdater::ChangeString(UINT id, const WCHAR* value)
{
    LANGID langId = stringTableMap_.empty() ? kLangEnUs
                                            : stringTableMap_.begin()->first;
    return ChangeString(langId, id, value);
}

bool ResourceUpdater::ChangeRcData(UINT id, const WCHAR* pathToResource)
{
    auto rcDataLngPairIt = std::find_if(rcDataLngMap_.begin(), rcDataLngMap_.end(), [=](const auto& rcDataLngPair) {
        return rcDataLngPair.second.find(id) != rcDataLngPair.second.end();
    });

    if (rcDataLngPairIt == rcDataLngMap_.end()) {
        fprintf(stderr, "Cannot find RCDATA with id '%u'\n", id);
        return false;
    }

    wchar_t abspath[MAX_PATH] = { 0 };
    const auto filePath = _wfullpath(abspath, pathToResource, MAX_PATH) ? abspath : pathToResource;
    ScopedFile newRcDataFile(filePath);
    if (newRcDataFile == INVALID_HANDLE_VALUE) {
        fprintf(stderr, "Cannot open new data file '%ws'\n", filePath);
        return false;
    }

    const auto dwFileSize = GetFileSize(newRcDataFile, NULL);
    if (dwFileSize == INVALID_FILE_SIZE) {
        fprintf(stderr, "Cannot get file size for '%ws'\n", filePath);
        return false;
    }

    auto& rcData = rcDataLngPairIt->second[id];
    rcData.clear();
    rcData.resize(dwFileSize);

    DWORD dwBytesRead { 0 };
    if (!ReadFile(newRcDataFile, rcData.data(), dwFileSize, &dwBytesRead, NULL)) {
        fprintf(stderr, "Cannot read file '%ws'\n", filePath);
        return false;
    }

    return true;
}

const WCHAR* ResourceUpdater::GetString(WORD languageId, UINT id)
{
    StringTable& table = stringTableMap_[languageId];

    UINT blockId = id / 16;
    if (table.find(blockId) == table.end()) {
        // Fill the table until we reach the block.
        for (size_t i = table.size(); i <= blockId; ++i) {
            table[i] = std::vector<std::wstring>(16);
        }
    }

    assert(table[blockId].size() == 16);
    UINT blockIndex = id % 16;

    return table[blockId][blockIndex].c_str();
}

const WCHAR* ResourceUpdater::GetString(UINT id)
{
    LANGID langId = stringTableMap_.empty() ? kLangEnUs
                                            : stringTableMap_.begin()->first;
    return GetString(langId, id);
}

bool ResourceUpdater::SetIcon(const WCHAR* path, const LANGID& langId,
    UINT iconBundle)
{
    std::unique_ptr<IconsValue>& pIcon = iconBundleMap_[langId].iconBundles[iconBundle];
    if (!pIcon)
        pIcon = std::make_unique<IconsValue>();

    auto& icon = *pIcon;
    DWORD bytes;

    ScopedFile file(path);
    if (file == INVALID_HANDLE_VALUE) {
        fwprintf(stderr, L"Cannot open icon file '%ls'\n", path);
        return false;
    }

    IconsValue::ICONHEADER& header = icon.header;
    if (!ReadFile(file, &header, 3 * sizeof(WORD), &bytes, NULL)) {
        fwprintf(stderr, L"Cannot read icon header for '%ls'\n", path);
        return false;
    }

    if (header.reserved != 0 || header.type != 1) {
        fwprintf(stderr, L"Reserved header is not 0 or image type is not icon for '%ls'\n", path);
        return false;
    }

    header.entries.resize(header.count);
    if (!ReadFile(file, header.entries.data(), header.count * sizeof(IconsValue::ICONENTRY), &bytes, NULL)) {
        fwprintf(stderr, L"Cannot read icon metadata for '%ls'\n", path);
        return false;
    }

    icon.images.resize(header.count);
    for (size_t i = 0; i < header.count; ++i) {
        icon.images[i].resize(header.entries[i].bytesInRes);
        SetFilePointer(file, header.entries[i].imageOffset, NULL, FILE_BEGIN);
        if (!ReadFile(file, icon.images[i].data(), icon.images[i].size(), &bytes, NULL)) {
            fwprintf(stderr, L"Cannot read icon data for '%ls'\n", path);
            return false;
        }
    }

    icon.grpHeader.resize(3 * sizeof(WORD) + header.count * sizeof(GRPICONENTRY));
    GRPICONHEADER* pGrpHeader = reinterpret_cast<GRPICONHEADER*>(icon.grpHeader.data());
    pGrpHeader->reserved = 0;
    pGrpHeader->type = 1;
    pGrpHeader->count = header.count;
    for (size_t i = 0; i < header.count; ++i) {
        GRPICONENTRY* entry = pGrpHeader->entries + i;
        entry->bitCount = 0;
        entry->bytesInRes = header.entries[i].bitCount;
        entry->bytesInRes2 = header.entries[i].bytesInRes;
        entry->colourCount = header.entries[i].colorCount;
        entry->height = header.entries[i].height;
        entry->id = i + 1;
        entry->planes = header.entries[i].planes;
        entry->reserved = header.entries[i].reserved;
        entry->width = header.entries[i].width;
        entry->reserved2 = 0;
    }

    return true;
}

bool ResourceUpdater::SetIcon(const WCHAR* path, const LANGID& langId)
{
    if (iconBundleMap_[langId].iconBundles.empty()) {
        return SetIcon(path, langId, kDefaultIconBundle);
    }
    UINT iconBundle = iconBundleMap_[langId].iconBundles.begin()->first;
    return SetIcon(path, langId, iconBundle);
}

bool ResourceUpdater::SetIcon(const WCHAR* path)
{
    LANGID langId = iconBundleMap_.empty() ? kLangEnUs
                                           : iconBundleMap_.begin()->first;
    return SetIcon(path, langId);
}

bool ResourceUpdater::Commit()
{
    if (module_ == NULL) {
        return false;
    }
    FreeLibrary(module_);
    module_ = NULL;

    ScopedResourceUpdater ru(filename_.c_str(), false);
    if (ru.Get() == NULL) {
        return false;
    }

    // update version info.
    for (const auto& i : versionStampMap_) {
        LANGID langId = i.first;
        std::vector<BYTE> out = i.second.Serialize();

        if (!UpdateResourceW(ru.Get(), RT_VERSION, MAKEINTRESOURCEW(1), langId,
                &out[0], static_cast<DWORD>(out.size()))) {
            return false;
        }
    }

    // update the execution level
    if (applicationManifestPath_.empty() && !executionLevel_.empty()) {
        // string replace with requested executionLevel
        std::wstring::size_type pos = 0u;
        while ((pos = manifestString_.find(originalExecutionLevel_, pos)) != std::string::npos) {
            manifestString_.replace(pos, originalExecutionLevel_.length(), executionLevel_);
            pos += executionLevel_.length();
        }

        // clean old padding and add new padding, ensuring that the size is a multiple of 4
        std::wstring::size_type padPos = manifestString_.find(L"</assembly>");
        // trim anything after the </assembly>, 11 being the length of </assembly> (ie, remove old padding)
        std::wstring trimmedStr = manifestString_.substr(0, padPos + 11);
        std::wstring padding = L"\n<!--Padding to make filesize even multiple of 4 X -->";

        int offset = (trimmedStr.length() + padding.length()) % 4;
        // multiple X by the number in offset
        pos = 0u;
        for (int posCount = 0; posCount < offset; posCount = posCount + 1) {
            if ((pos = padding.find(L"X", pos)) != std::string::npos) {
                padding.replace(pos, 1, L"XX");
                pos += executionLevel_.length();
            }
        }

        // convert the wchar back into char, so that it encodes correctly for Windows to read the XML.
        std::wstring stringSectionW = trimmedStr + padding;
        std::wstring_convert<std::codecvt_utf8<wchar_t>, wchar_t> converter;
        std::string stringSection = converter.to_bytes(stringSectionW);

        if (!UpdateResourceW(ru.Get(), RT_MANIFEST, MAKEINTRESOURCEW(1),
                kLangEnUs, // this is hardcoded at 1033, ie, en-us, as that is what RT_MANIFEST default uses
                &stringSection.at(0), sizeof(char) * stringSection.size())) {
            return false;
        }
    }

    // load file contents and replace the manifest
    if (!applicationManifestPath_.empty()) {
        std::wstring fileContents = ReadFileToString(applicationManifestPath_.c_str());

        // clean old padding and add new padding, ensuring that the size is a multiple of 4
        std::wstring::size_type padPos = fileContents.find(L"</assembly>");
        // trim anything after the </assembly>, 11 being the length of </assembly> (ie, remove old padding)
        std::wstring trimmedStr = fileContents.substr(0, padPos + 11);
        std::wstring padding = L"\n<!--Padding to make filesize even multiple of 4 X -->";

        int offset = (trimmedStr.length() + padding.length()) % 4;
        // multiple X by the number in offset
        std::wstring::size_type pos = 0u;
        for (int posCount = 0; posCount < offset; posCount = posCount + 1) {
            if ((pos = padding.find(L"X", pos)) != std::string::npos) {
                padding.replace(pos, 1, L"XX");
                pos += executionLevel_.length();
            }
        }

        // convert the wchar back into char, so that it encodes correctly for Windows to read the XML.
        std::wstring stringSectionW = fileContents + padding;
        std::wstring_convert<std::codecvt_utf8<wchar_t>, wchar_t> converter;
        std::string stringSection = converter.to_bytes(stringSectionW);

        if (!UpdateResourceW(ru.Get(), RT_MANIFEST, MAKEINTRESOURCEW(1),
                kLangEnUs, // this is hardcoded at 1033, ie, en-us, as that is what RT_MANIFEST default uses
                &stringSection.at(0), sizeof(char) * stringSection.size())) {
            return false;
        }
    }

    // update string table.
    for (const auto& i : stringTableMap_) {
        for (const auto& j : i.second) {
            std::vector<char> stringTableBuffer;
            if (!SerializeStringTable(j.second, j.first, &stringTableBuffer)) {
                return false;
            }

            if (!UpdateResourceW(ru.Get(), RT_STRING, MAKEINTRESOURCEW(j.first + 1), i.first,
                    &stringTableBuffer[0], static_cast<DWORD>(stringTableBuffer.size()))) {
                return false;
            }
        }
    }

    for (const auto& rcDataLangPair : rcDataLngMap_) {
        for (const auto& rcDataMap : rcDataLangPair.second) {
            if (!UpdateResourceW(ru.Get(), RT_RCDATA, reinterpret_cast<LPWSTR>(rcDataMap.first),
                    rcDataLangPair.first, (LPVOID)rcDataMap.second.data(), rcDataMap.second.size())) {
                return false;
            }
        }
    }

    for (const auto& iLangIconInfoPair : iconBundleMap_) {
        auto langId = iLangIconInfoPair.first;
        auto maxIconId = iLangIconInfoPair.second.maxIconId;
        for (const auto& iNameBundlePair : iLangIconInfoPair.second.iconBundles) {
            UINT bundleId = iNameBundlePair.first;
            const std::unique_ptr<IconsValue>& pIcon = iNameBundlePair.second;
            if (!pIcon)
                continue;

            auto& icon = *pIcon;
            // update icon.
            if (icon.grpHeader.size() > 0) {
                if (!UpdateResourceW(ru.Get(), RT_GROUP_ICON, MAKEINTRESOURCEW(bundleId),
                        langId, icon.grpHeader.data(), icon.grpHeader.size())) {
                    return false;
                }

                for (size_t i = 0; i < icon.header.count; ++i) {
                    if (!UpdateResourceW(ru.Get(), RT_ICON, MAKEINTRESOURCEW(i + 1),
                            langId, icon.images[i].data(), icon.images[i].size())) {

                        return false;
                    }
                }

                for (size_t i = icon.header.count; i < maxIconId; ++i) {
                    if (!UpdateResourceW(ru.Get(), RT_ICON, MAKEINTRESOURCEW(i + 1),
                            langId, nullptr, 0)) {
                        return false;
                    }
                }
            }
        }
    }

    return ru.Commit();
}

bool ResourceUpdater::SerializeStringTable(const StringValues& values, UINT blockId, std::vector<char>* out)
{
    // calc total size.
    // string table is pascal string list.
    size_t size = 0;
    for (size_t i = 0; i < 16; i++) {
        size += sizeof(WORD);
        size += values[i].length() * sizeof(WCHAR);
    }

    out->resize(size);

    // write.
    char* pDst = &(*out)[0];
    for (size_t i = 0; i < 16; i++) {
        WORD length = static_cast<WORD>(values[i].length());
        memcpy(pDst, &length, sizeof(length));
        pDst += sizeof(WORD);

        if (length > 0) {
            WORD bytes = length * sizeof(WCHAR);
            memcpy(pDst, values[i].c_str(), bytes);
            pDst += bytes;
        }
    }

    return true;
}

// static
BOOL CALLBACK ResourceUpdater::OnEnumResourceLanguage(HANDLE hModule, LPCWSTR lpszType, LPCWSTR lpszName, WORD wIDLanguage, LONG_PTR lParam)
{
    ResourceUpdater* instance = reinterpret_cast<ResourceUpdater*>(lParam);
    if (IS_INTRESOURCE(lpszName) && IS_INTRESOURCE(lpszType)) {
        // case reinterpret_cast<ptrdiff_t>(RT_VERSION): {
        switch (reinterpret_cast<ptrdiff_t>(lpszType)) {
        case 16: {
            try {
                instance->versionStampMap_[wIDLanguage] = VersionInfo(instance->module_, wIDLanguage);
            } catch (const std::system_error& e) {
                return false;
            }
            break;
        }
        case 6: {
            // case reinterpret_cast<ptrdiff_t>(RT_STRING): {
            UINT id = reinterpret_cast<ptrdiff_t>(lpszName) - 1;
            auto& vector = instance->stringTableMap_[wIDLanguage][id];
            for (size_t k = 0; k < 16; k++) {
                CStringW buf;

                buf.LoadStringW(instance->module_, id * 16 + k, wIDLanguage);
                vector.push_back(buf.GetBuffer());
            }
            break;
        }
        // case reinterpret_cast<ptrdiff_t>(RT_ICON): {
        case 3: {
            UINT iconId = reinterpret_cast<ptrdiff_t>(lpszName);
            UINT maxIconId = instance->iconBundleMap_[wIDLanguage].maxIconId;
            if (iconId > maxIconId)
                maxIconId = iconId;
            break;
        }
        // case reinterpret_cast<ptrdiff_t>(RT_GROUP_ICON): {
        case 14: {
            UINT iconId = reinterpret_cast<ptrdiff_t>(lpszName);
            instance->iconBundleMap_[wIDLanguage].iconBundles[iconId] = nullptr;
            break;
        }
        // case reinterpret_cast<ptrdiff_t>(RT_RCDATA): {
        case 10: {
            const auto moduleHandle = HMODULE(hModule);
            HRSRC hResInfo = FindResource(moduleHandle, lpszName, lpszType);
            DWORD cbResource = SizeofResource(moduleHandle, hResInfo);
            HGLOBAL hResData = LoadResource(moduleHandle, hResInfo);

            const auto* pResource = (const BYTE*)LockResource(hResData);
            const auto resId = reinterpret_cast<ptrdiff_t>(lpszName);
            instance->rcDataLngMap_[wIDLanguage][resId] = std::vector<BYTE>(pResource, pResource + cbResource);

            UnlockResource(hResData);
            FreeResource(hResData);
        }
        default:
            break;
        }
    }
    return TRUE;
}

// static
BOOL CALLBACK ResourceUpdater::OnEnumResourceName(HMODULE hModule, LPCWSTR lpszType, LPWSTR lpszName, LONG_PTR lParam)
{
    EnumResourceLanguagesW(hModule, lpszType, lpszName, (ENUMRESLANGPROCW)OnEnumResourceLanguage, lParam);
    return TRUE;
}

// static
// courtesy of http://stackoverflow.com/questions/420852/reading-an-applications-manifest-file
BOOL CALLBACK ResourceUpdater::OnEnumResourceManifest(HMODULE hModule, LPCTSTR lpType, LPWSTR lpName, LONG_PTR lParam)
{
    ResourceUpdater* instance = reinterpret_cast<ResourceUpdater*>(lParam);
    HRSRC hResInfo = FindResource(hModule, lpName, lpType);
    DWORD cbResource = SizeofResource(hModule, hResInfo);

    HGLOBAL hResData = LoadResource(hModule, hResInfo);
    const BYTE* pResource = (const BYTE*)LockResource(hResData);

    // FIXME(zcbenz): Do a real UTF string convertion.
    int len = strlen(reinterpret_cast<const char*>(pResource));
    std::wstring manifestStringLocal(pResource, pResource + len);

    // FIXME(zcbenz): Strip the BOM instead of doing string search.
    size_t start = manifestStringLocal.find(L"<?xml");
    if (start > 0) {
        manifestStringLocal = manifestStringLocal.substr(start);
    }

    // Support alternative formatting, such as using " vs ' and level="..." on another line
    size_t found = manifestStringLocal.find(L"requestedExecutionLevel");
    size_t level = manifestStringLocal.find(L"level=\"", found);
    size_t end = manifestStringLocal.find(L"\"", level + 7);
    if (level < 0) {
        level = manifestStringLocal.find(L"level=\'", found);
        end = manifestStringLocal.find(L"\'", level + 7);
    }

    instance->originalExecutionLevel_ = manifestStringLocal.substr(level + 7, end - level - 7);

    // also store original manifestString
    instance->manifestString_ = manifestStringLocal;

    UnlockResource(hResData);
    FreeResource(hResData);

    return TRUE; // Keep going
}

ScopedResourceUpdater::ScopedResourceUpdater(const WCHAR* filename, bool deleteOld)
    : handle_(BeginUpdateResourceW(filename, deleteOld))
{
}

ScopedResourceUpdater::~ScopedResourceUpdater()
{
    if (!commited_) {
        EndUpdate(false);
    }
}

HANDLE ScopedResourceUpdater::Get() const
{
    return handle_;
}

bool ScopedResourceUpdater::Commit()
{
    commited_ = true;
    return EndUpdate(true);
}

bool ScopedResourceUpdater::EndUpdate(bool doesCommit)
{
    BOOL fDiscard = doesCommit ? FALSE : TRUE;
    BOOL bResult = EndUpdateResourceW(handle_, fDiscard);
    DWORD e = GetLastError();
    return bResult ? true : false;
}

} // namespace rescle
