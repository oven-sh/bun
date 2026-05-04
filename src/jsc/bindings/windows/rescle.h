// This file is from Electron's fork of rescle
// https://github.com/electron/rcedit/blob/e36b688b42df0e236922019ce14e0ea165dc176d/src/rescle.h
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

#ifndef VERSION_INFO_UPDATER
#define VERSION_INFO_UPDATER

#ifndef _UNICODE
#define _UNICODE
#endif

#ifndef UNICODE
#define UNICODE
#endif

#include <string>
#include <vector>
#include <map>

#include <windows.h>
#include <memory> // unique_ptr

#define RU_VS_COMMENTS L"Comments"
#define RU_VS_COMPANY_NAME L"CompanyName"
#define RU_VS_FILE_DESCRIPTION L"FileDescription"
#define RU_VS_FILE_VERSION L"FileVersion"
#define RU_VS_INTERNAL_NAME L"InternalName"
#define RU_VS_LEGAL_COPYRIGHT L"LegalCopyright"
#define RU_VS_LEGAL_TRADEMARKS L"LegalTrademarks"
#define RU_VS_ORIGINAL_FILENAME L"OriginalFilename"
#define RU_VS_PRIVATE_BUILD L"PrivateBuild"
#define RU_VS_PRODUCT_NAME L"ProductName"
#define RU_VS_PRODUCT_VERSION L"ProductVersion"
#define RU_VS_SPECIAL_BUILD L"SpecialBuild"

namespace rescle {

struct IconsValue {
    typedef struct _ICONENTRY {
        BYTE width;
        BYTE height;
        BYTE colorCount;
        BYTE reserved;
        WORD planes;
        WORD bitCount;
        DWORD bytesInRes;
        DWORD imageOffset;
    } ICONENTRY;

    typedef struct _ICONHEADER {
        WORD reserved;
        WORD type;
        WORD count;
        std::vector<ICONENTRY> entries;
    } ICONHEADER;

    ICONHEADER header;
    std::vector<std::vector<BYTE>> images;
    std::vector<BYTE> grpHeader;
};

struct Translate {
    LANGID wLanguage;
    WORD wCodePage;
};

typedef std::pair<std::wstring, std::wstring> VersionString;
typedef std::pair<const BYTE* const, const size_t> OffsetLengthPair;

struct VersionStringTable {
    Translate encoding;
    std::vector<VersionString> strings;
};

class VersionInfo {
public:
    VersionInfo();
    VersionInfo(HMODULE hModule, WORD languageId);

    std::vector<BYTE> Serialize() const;

    bool HasFixedFileInfo() const;
    VS_FIXEDFILEINFO& GetFixedFileInfo();
    const VS_FIXEDFILEINFO& GetFixedFileInfo() const;
    void SetFixedFileInfo(const VS_FIXEDFILEINFO& value);

    std::vector<VersionStringTable> stringTables;
    std::vector<Translate> supportedTranslations;

private:
    VS_FIXEDFILEINFO fixedFileInfo_;

    void FillDefaultData();
    void DeserializeVersionInfo(const BYTE* pData, size_t size);

    VersionStringTable DeserializeVersionStringTable(const BYTE* tableData);
    void DeserializeVersionStringFileInfo(const BYTE* offset, size_t length, std::vector<VersionStringTable>& stringTables);
    void DeserializeVarFileInfo(const unsigned char* offset, std::vector<Translate>& translations);
    OffsetLengthPair GetChildrenData(const BYTE* entryData);
};

class ResourceUpdater {
public:
    typedef std::vector<std::wstring> StringValues;
    typedef std::map<UINT, StringValues> StringTable;
    typedef std::map<WORD, StringTable> StringTableMap;
    typedef std::map<LANGID, VersionInfo> VersionStampMap;
    typedef std::map<UINT, std::unique_ptr<IconsValue>> IconTable;
    typedef std::vector<BYTE> RcDataValue;
    typedef std::map<ptrdiff_t, RcDataValue> RcDataMap;
    typedef std::map<LANGID, RcDataMap> RcDataLangMap;

    struct IconResInfo {
        UINT maxIconId = 0;
        IconTable iconBundles;
    };

    typedef std::map<LANGID, IconResInfo> IconTableMap;

    ResourceUpdater();
    ~ResourceUpdater();

    bool Load(const WCHAR* filename);
    bool SetVersionString(WORD languageId, const WCHAR* name, const WCHAR* value);
    bool SetVersionString(const WCHAR* name, const WCHAR* value);
    const WCHAR* GetVersionString(WORD languageId, const WCHAR* name);
    const WCHAR* GetVersionString(const WCHAR* name);
    bool SetProductVersion(WORD languageId, UINT id, unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4);
    bool SetProductVersion(unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4);
    bool SetFileVersion(WORD languageId, UINT id, unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4);
    bool SetFileVersion(unsigned short v1, unsigned short v2, unsigned short v3, unsigned short v4);
    bool ChangeString(WORD languageId, UINT id, const WCHAR* value);
    bool ChangeString(UINT id, const WCHAR* value);
    bool ChangeRcData(UINT id, const WCHAR* pathToResource);
    const WCHAR* GetString(WORD languageId, UINT id);
    const WCHAR* GetString(UINT id);
    bool SetIcon(const WCHAR* path, const LANGID& langId, UINT iconBundle);
    bool SetIcon(const WCHAR* path, const LANGID& langId);
    bool SetIcon(const WCHAR* path);
    bool SetExecutionLevel(const WCHAR* value);
    bool IsExecutionLevelSet();
    bool SetApplicationManifest(const WCHAR* value);
    bool IsApplicationManifestSet();
    bool Commit();

private:
    bool SerializeStringTable(const StringValues& values, UINT blockId, std::vector<char>* out);

    static BOOL CALLBACK OnEnumResourceName(HMODULE hModule, LPCWSTR lpszType, LPWSTR lpszName, LONG_PTR lParam);
    static BOOL CALLBACK OnEnumResourceManifest(HMODULE hModule, LPCWSTR lpszType, LPWSTR lpszName, LONG_PTR lParam);
    static BOOL CALLBACK OnEnumResourceLanguage(HANDLE hModule, LPCWSTR lpszType, LPCWSTR lpszName, WORD wIDLanguage, LONG_PTR lParam);

    HMODULE module_;
    std::wstring filename_;
    std::wstring executionLevel_;
    std::wstring originalExecutionLevel_;
    std::wstring applicationManifestPath_;
    std::wstring manifestString_;
    VersionStampMap versionStampMap_;
    StringTableMap stringTableMap_;
    IconTableMap iconBundleMap_;
    RcDataLangMap rcDataLngMap_;
};

class ScopedResourceUpdater {
public:
    ScopedResourceUpdater(const WCHAR* filename, bool deleteOld);
    ~ScopedResourceUpdater();

    HANDLE Get() const;
    bool Commit();

private:
    bool EndUpdate(bool doesCommit);

    HANDLE handle_;
    bool commited_ = false;
};

} // namespace rescle

#endif // VERSION_INFO_UPDATER
