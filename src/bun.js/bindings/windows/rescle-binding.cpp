#include "root.h"
#include "rescle.h"
#include <fstream>
#include <sstream>
#include <regex>
#include <cwchar>

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

extern "C" int rescle__applyRCFile(const WCHAR* exeFilename, const WCHAR* rcFilename)
{
    rescle::ResourceUpdater updater;
    if (!updater.Load(exeFilename))
        return -1;

    // Read the RC file
    std::wifstream rcFile(rcFilename);
    if (!rcFile.is_open())
        return -2;

    std::wstring line;
    bool inVersionInfo = false;
    bool inStringFileInfo = false;
    bool inBlock = false;
    
    // Regular expressions to parse RC content
    std::wregex versionInfoStart(L"VS_VERSION_INFO\\s+VERSIONINFO");
    std::wregex stringFileInfoStart(L"BLOCK\\s+\"StringFileInfo\"");
    std::wregex blockStart(L"BLOCK\\s+\"[^\"]+\"");
    std::wregex valueRegex(L"VALUE\\s+\"([^\"]+)\"\\s*,\\s*\"([^\"]+)\"");
    std::wregex iconRegex(L"([A-Z_0-9]+)\\s+ICON\\s+\"([^\"]+)\"");
    std::wregex fileVersionRegex(L"FILEVERSION\\s+(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)");
    std::wregex productVersionRegex(L"PRODUCTVERSION\\s+(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)");

    while (std::getline(rcFile, line)) {
        // Trim whitespace
        line.erase(0, line.find_first_not_of(L" \t"));
        line.erase(line.find_last_not_of(L" \t") + 1);
        
        if (line.empty() || line[0] == L'#' || line.substr(0, 2) == L"//")
            continue;

        std::wsmatch match;
        
        // Check for ICON resources
        if (std::regex_search(line, match, iconRegex)) {
            std::wstring iconPath = match[2].str();
            // Convert relative path to absolute if needed
            if (!updater.SetIcon(iconPath.c_str())) {
                // Icon setting failed, but continue processing other resources
            }
            continue;
        }
        
        // Check for VERSION_INFO start
        if (std::regex_search(line, versionInfoStart)) {
            inVersionInfo = true;
            continue;
        }
        
        if (!inVersionInfo) continue;
        
        // Check for FILEVERSION
        if (std::regex_search(line, match, fileVersionRegex)) {
            unsigned short v1 = (unsigned short)std::wcstol(match[1].str().c_str(), nullptr, 10);
            unsigned short v2 = (unsigned short)std::wcstol(match[2].str().c_str(), nullptr, 10);
            unsigned short v3 = (unsigned short)std::wcstol(match[3].str().c_str(), nullptr, 10);
            unsigned short v4 = (unsigned short)std::wcstol(match[4].str().c_str(), nullptr, 10);
            updater.SetFileVersion(v1, v2, v3, v4);
            continue;
        }
        
        // Check for PRODUCTVERSION
        if (std::regex_search(line, match, productVersionRegex)) {
            unsigned short v1 = (unsigned short)std::wcstol(match[1].str().c_str(), nullptr, 10);
            unsigned short v2 = (unsigned short)std::wcstol(match[2].str().c_str(), nullptr, 10);
            unsigned short v3 = (unsigned short)std::wcstol(match[3].str().c_str(), nullptr, 10);
            unsigned short v4 = (unsigned short)std::wcstol(match[4].str().c_str(), nullptr, 10);
            updater.SetProductVersion(v1, v2, v3, v4);
            continue;
        }
        
        // Check for StringFileInfo
        if (std::regex_search(line, stringFileInfoStart)) {
            inStringFileInfo = true;
            continue;
        }
        
        // Check for block start
        if (inStringFileInfo && std::regex_search(line, blockStart)) {
            inBlock = true;
            continue;
        }
        
        // Check for END
        if (line == L"END") {
            if (inBlock) {
                inBlock = false;
            } else if (inStringFileInfo) {
                inStringFileInfo = false;
            } else if (inVersionInfo) {
                inVersionInfo = false;
            }
            continue;
        }
        
        // Check for VALUE entries
        if (inBlock && std::regex_search(line, match, valueRegex)) {
            std::wstring key = match[1].str();
            std::wstring value = match[2].str();
            
            // Map common RC file keys to rescle constants
            if (key == L"FileDescription") {
                updater.SetVersionString(L"FileDescription", value.c_str());
            } else if (key == L"FileVersion") {
                updater.SetVersionString(L"FileVersion", value.c_str());
            } else if (key == L"InternalName") {
                updater.SetVersionString(L"InternalName", value.c_str());
            } else if (key == L"OriginalFilename") {
                updater.SetVersionString(L"OriginalFilename", value.c_str());
            } else if (key == L"ProductName") {
                updater.SetVersionString(L"ProductName", value.c_str());
            } else if (key == L"ProductVersion") {
                updater.SetVersionString(L"ProductVersion", value.c_str());
            } else if (key == L"CompanyName") {
                updater.SetVersionString(L"CompanyName", value.c_str());
            } else if (key == L"LegalCopyright") {
                updater.SetVersionString(L"LegalCopyright", value.c_str());
            } else if (key == L"LegalTrademarks") {
                updater.SetVersionString(L"LegalTrademarks", value.c_str());
            } else if (key == L"Comments") {
                updater.SetVersionString(L"Comments", value.c_str());
            } else if (key == L"PrivateBuild") {
                updater.SetVersionString(L"PrivateBuild", value.c_str());
            } else if (key == L"SpecialBuild") {
                updater.SetVersionString(L"SpecialBuild", value.c_str());
            }
        }
    }
    
    rcFile.close();
    
    if (!updater.Commit())
        return -3;
        
    return 0;
}
