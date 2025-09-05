#include "root.h"
#include "rescle.h"

extern "C" int rescle__setIcon(const WCHAR* exeFilename, const WCHAR* iconFilename)
{
    rescle::ResourceUpdater updater;
    if (!updater.Load(exeFilename))
        return -1;
    if (!updater.SetIcon(iconFilename))
        return -2;
    if (!updater.Commit())
        return -3;
    return 0;
}

// Unified function to set all Windows metadata in a single operation
extern "C" int rescle__setWindowsMetadata(
    const WCHAR* exeFilename,
    const WCHAR* iconFilename,
    const WCHAR* title,
    const WCHAR* publisher,
    const WCHAR* version,
    const WCHAR* description,
    const WCHAR* copyright)
{
    rescle::ResourceUpdater updater;
    
    // Load the executable once
    if (!updater.Load(exeFilename))
        return -1;

    // Set icon if provided (check for non-null and non-empty)
    if (iconFilename && iconFilename != nullptr && *iconFilename != L'\0') {
        if (!updater.SetIcon(iconFilename))
            return -2;
    }

    // Set Product Name (title)
    if (title && *title) {
        if (!updater.SetVersionString(RU_VS_PRODUCT_NAME, title))
            return -3;
    }

    // Set Company Name (publisher)
    if (publisher && *publisher) {
        if (!updater.SetVersionString(RU_VS_COMPANY_NAME, publisher))
            return -4;
    }

    // Set File Description
    if (description && *description) {
        if (!updater.SetVersionString(RU_VS_FILE_DESCRIPTION, description))
            return -5;
    }

    // Set Legal Copyright
    if (copyright && *copyright) {
        if (!updater.SetVersionString(RU_VS_LEGAL_COPYRIGHT, copyright))
            return -6;
    }

    // Set File Version and Product Version
    if (version && *version) {
        // Parse version string like "1", "1.2", "1.2.3", or "1.2.3.4"
        unsigned short v1 = 0, v2 = 0, v3 = 0, v4 = 0;
        int parsed = swscanf_s(version, L"%hu.%hu.%hu.%hu", &v1, &v2, &v3, &v4);
        
        if (parsed > 0) {
            // Set both file version and product version
            if (!updater.SetFileVersion(v1, v2, v3, v4))
                return -7;
            if (!updater.SetProductVersion(v1, v2, v3, v4))
                return -8;
            
            // Create normalized version string "v1.v2.v3.v4"
            WCHAR normalizedVersion[32];
            swprintf_s(normalizedVersion, 32, L"%hu.%hu.%hu.%hu", v1, v2, v3, v4);
            
            // Set the string representation with normalized version
            if (!updater.SetVersionString(RU_VS_FILE_VERSION, normalizedVersion))
                return -9;
            if (!updater.SetVersionString(RU_VS_PRODUCT_VERSION, normalizedVersion))
                return -10;
        } else {
            // Invalid version format
            return -11;
        }
    }

    // Remove the "Original Filename" field by setting it to empty
    // This prevents the compiled executable from showing "bun.exe" as the original filename
    if (!updater.SetVersionString(RU_VS_ORIGINAL_FILENAME, L""))
        return -13;

    // Commit all changes at once
    if (!updater.Commit())
        return -12;
        
    return 0;
}
