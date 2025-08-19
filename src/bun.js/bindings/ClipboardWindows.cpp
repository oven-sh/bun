#include "root.h"

#if OS(WINDOWS)

#include "Clipboard.h"
#include <windows.h>
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <wtf/text/StringView.h>
#include <thread>

namespace Bun {
namespace Clipboard {

using namespace WTF;

static void updateError(Error& err, const String& message, DWORD code = 0)
{
    err.type = ErrorType::PlatformError;
    err.message = message;
    err.code = static_cast<int>(code);
}

class WindowsClipboard {
public:
    static bool open()
    {
        return OpenClipboard(nullptr) != 0;
    }

    static void close()
    {
        CloseClipboard();
    }

    static bool clear()
    {
        return EmptyClipboard() != 0;
    }
};

Error writeText(const String& text)
{
    Error err;

    if (!WindowsClipboard::open()) {
        updateError(err, "Failed to open clipboard"_s, GetLastError());
        return err;
    }

    if (!WindowsClipboard::clear()) {
        updateError(err, "Failed to clear clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    // Convert to UTF-16  
    auto textSize = (text.length() + 1) * sizeof(wchar_t);

    HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, textSize);
    if (!hGlobal) {
        updateError(err, "Failed to allocate memory"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    wchar_t* buffer = static_cast<wchar_t*>(GlobalLock(hGlobal));
    if (!buffer) {
        updateError(err, "Failed to lock memory"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    // Copy UTF-16 data
    Vector<UChar> characters = text.charactersWithNullTermination();
    memcpy(buffer, characters.data(), text.length() * sizeof(UChar));
    buffer[text.length()] = L'\0';
    GlobalUnlock(hGlobal);

    if (!SetClipboardData(CF_UNICODETEXT, hGlobal)) {
        updateError(err, "Failed to set clipboard data"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    WindowsClipboard::close();
    return err;
}

Error writeHTML(const String& html)
{
    Error err;

    // Register CF_HTML format if not already registered
    static UINT CF_HTML = RegisterClipboardFormat(L"HTML Format");
    if (!CF_HTML) {
        updateError(err, "Failed to register HTML clipboard format"_s, GetLastError());
        return err;
    }

    if (!WindowsClipboard::open()) {
        updateError(err, "Failed to open clipboard"_s, GetLastError());
        return err;
    }

    if (!WindowsClipboard::clear()) {
        updateError(err, "Failed to clear clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    // Create CF_HTML format
    auto htmlUtf8 = html.utf8();
    String htmlHeader = makeString(
        "Version:0.9\r\n"
        "StartHTML:0000000105\r\n"
        "EndHTML:"_s, String::number(105 + htmlUtf8.length()), "\r\n"
        "StartFragment:0000000105\r\n"
        "EndFragment:"_s, String::number(105 + htmlUtf8.length()), "\r\n"
        "<html><body><!--StartFragment-->"_s
    );
    String htmlFooter = "<!--EndFragment--></body></html>"_s;
    
    auto fullHtml = makeString(htmlHeader, String::fromUTF8(htmlUtf8.data()), htmlFooter);
    auto fullHtmlUtf8 = fullHtml.utf8();

    HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, fullHtmlUtf8.length() + 1);
    if (!hGlobal) {
        updateError(err, "Failed to allocate memory"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    char* buffer = static_cast<char*>(GlobalLock(hGlobal));
    if (!buffer) {
        updateError(err, "Failed to lock memory"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    memcpy(buffer, fullHtmlUtf8.data(), fullHtmlUtf8.length());
    buffer[fullHtmlUtf8.length()] = '\0';
    GlobalUnlock(hGlobal);

    if (!SetClipboardData(CF_HTML, hGlobal)) {
        updateError(err, "Failed to set HTML clipboard data"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    WindowsClipboard::close();
    return err;
}

Error writeRTF(const String& rtf)
{
    Error err;

    // Register RTF format if not already registered
    static UINT CF_RTF = RegisterClipboardFormat(L"Rich Text Format");
    if (!CF_RTF) {
        updateError(err, "Failed to register RTF clipboard format"_s, GetLastError());
        return err;
    }

    if (!WindowsClipboard::open()) {
        updateError(err, "Failed to open clipboard"_s, GetLastError());
        return err;
    }

    if (!WindowsClipboard::clear()) {
        updateError(err, "Failed to clear clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    auto rtfUtf8 = rtf.utf8();

    HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, rtfUtf8.length() + 1);
    if (!hGlobal) {
        updateError(err, "Failed to allocate memory"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    char* buffer = static_cast<char*>(GlobalLock(hGlobal));
    if (!buffer) {
        updateError(err, "Failed to lock memory"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    memcpy(buffer, rtfUtf8.data(), rtfUtf8.length());
    buffer[rtfUtf8.length()] = '\0';
    GlobalUnlock(hGlobal);

    if (!SetClipboardData(CF_RTF, hGlobal)) {
        updateError(err, "Failed to set RTF clipboard data"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    WindowsClipboard::close();
    return err;
}

Error writeImage(const Vector<uint8_t>& imageData, const String& mimeType)
{
    Error err;

    if (!WindowsClipboard::open()) {
        updateError(err, "Failed to open clipboard"_s, GetLastError());
        return err;
    }

    if (!WindowsClipboard::clear()) {
        updateError(err, "Failed to clear clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, imageData.size());
    if (!hGlobal) {
        updateError(err, "Failed to allocate memory"_s, GetLastError());
        WindowsClipboard::close();
        return err;
    }

    void* buffer = GlobalLock(hGlobal);
    if (!buffer) {
        updateError(err, "Failed to lock memory"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    memcpy(buffer, imageData.data(), imageData.size());
    GlobalUnlock(hGlobal);

    // Use DIB format for generic image data
    UINT format = CF_DIB;
    if (mimeType == "image/png"_s) {
        // Register PNG format
        static UINT CF_PNG = RegisterClipboardFormat(L"PNG");
        if (CF_PNG) format = CF_PNG;
    }

    if (!SetClipboardData(format, hGlobal)) {
        updateError(err, "Failed to set image clipboard data"_s, GetLastError());
        GlobalFree(hGlobal);
        WindowsClipboard::close();
        return err;
    }

    WindowsClipboard::close();
    return err;
}

std::optional<String> readText(Error& error)
{
    error = Error {};

    if (!WindowsClipboard::open()) {
        updateError(error, "Failed to open clipboard"_s, GetLastError());
        return std::nullopt;
    }

    HANDLE hData = GetClipboardData(CF_UNICODETEXT);
    if (!hData) {
        updateError(error, "No text found in clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    wchar_t* buffer = static_cast<wchar_t*>(GlobalLock(hData));
    if (!buffer) {
        updateError(error, "Failed to lock clipboard data"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    String text = String(std::span<const UChar>(reinterpret_cast<const UChar*>(buffer), wcslen(buffer)));
    GlobalUnlock(hData);
    WindowsClipboard::close();

    return text;
}

std::optional<String> readHTML(Error& error)
{
    error = Error {};

    static UINT CF_HTML = RegisterClipboardFormat(L"HTML Format");
    if (!CF_HTML) {
        updateError(error, "Failed to register HTML clipboard format"_s, GetLastError());
        return std::nullopt;
    }

    if (!WindowsClipboard::open()) {
        updateError(error, "Failed to open clipboard"_s, GetLastError());
        return std::nullopt;
    }

    HANDLE hData = GetClipboardData(CF_HTML);
    if (!hData) {
        updateError(error, "No HTML found in clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    char* buffer = static_cast<char*>(GlobalLock(hData));
    if (!buffer) {
        updateError(error, "Failed to lock clipboard data"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    String html = String::fromUTF8(buffer);
    GlobalUnlock(hData);
    WindowsClipboard::close();

    return html;
}

std::optional<String> readRTF(Error& error)
{
    error = Error {};

    static UINT CF_RTF = RegisterClipboardFormat(L"Rich Text Format");
    if (!CF_RTF) {
        updateError(error, "Failed to register RTF clipboard format"_s, GetLastError());
        return std::nullopt;
    }

    if (!WindowsClipboard::open()) {
        updateError(error, "Failed to open clipboard"_s, GetLastError());
        return std::nullopt;
    }

    HANDLE hData = GetClipboardData(CF_RTF);
    if (!hData) {
        updateError(error, "No RTF found in clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    char* buffer = static_cast<char*>(GlobalLock(hData));
    if (!buffer) {
        updateError(error, "Failed to lock clipboard data"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    String rtf = String::fromUTF8(buffer);
    GlobalUnlock(hData);
    WindowsClipboard::close();

    return rtf;
}

std::optional<Vector<uint8_t>> readImage(Error& error, String& mimeType)
{
    error = Error {};

    if (!WindowsClipboard::open()) {
        updateError(error, "Failed to open clipboard"_s, GetLastError());
        return std::nullopt;
    }

    // Try PNG format first
    static UINT CF_PNG = RegisterClipboardFormat(L"PNG");
    HANDLE hData = nullptr;
    
    if (CF_PNG) {
        hData = GetClipboardData(CF_PNG);
        if (hData) {
            mimeType = "image/png"_s;
        }
    }

    if (!hData) {
        // Try DIB format
        hData = GetClipboardData(CF_DIB);
        if (hData) {
            mimeType = "image/bmp"_s;
        }
    }

    if (!hData) {
        updateError(error, "No image found in clipboard"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    void* buffer = GlobalLock(hData);
    if (!buffer) {
        updateError(error, "Failed to lock clipboard data"_s, GetLastError());
        WindowsClipboard::close();
        return std::nullopt;
    }

    SIZE_T dataSize = GlobalSize(hData);
    Vector<uint8_t> result;
    result.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(buffer), dataSize));

    GlobalUnlock(hData);
    WindowsClipboard::close();

    return result;
}

bool isSupported()
{
    return true; // Windows clipboard is always available
}

Vector<DataType> getSupportedTypes()
{
    Vector<DataType> types;
    types.append(DataType::Text);
    types.append(DataType::HTML);
    types.append(DataType::RTF);
    types.append(DataType::Image);
    return types;
}

// Async implementations using std::thread - consistent with other platforms
void writeTextAsync(const String& text, WriteCallback callback) {
    std::thread([text = text.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeText(text);
        callback(error);
    }).detach();
}

void writeHTMLAsync(const String& html, WriteCallback callback) {
    std::thread([html = html.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeHTML(html);
        callback(error);
    }).detach();
}

void writeRTFAsync(const String& rtf, WriteCallback callback) {
    std::thread([rtf = rtf.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeRTF(rtf);
        callback(error);
    }).detach();
}

void writeImageAsync(const Vector<uint8_t>& imageData, const String& mimeType, WriteCallback callback) {
    std::thread([imageData, mimeType = mimeType.isolatedCopy(), callback = std::move(callback)]() {
        Error error = writeImage(imageData, mimeType);
        callback(error);
    }).detach();
}

void readTextAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        auto text = readText(error);
        Vector<ClipboardData> data;
        
        if (text.has_value() && !text->isEmpty()) {
            ClipboardData clipData;
            clipData.type = DataType::Text;
            clipData.mimeType = "text/plain"_s;
            auto textUtf8 = text->utf8();
            clipData.data.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(textUtf8.data()), textUtf8.length()));
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

void readHTMLAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        auto html = readHTML(error);
        Vector<ClipboardData> data;
        
        if (html.has_value() && !html->isEmpty()) {
            ClipboardData clipData;
            clipData.type = DataType::HTML;
            clipData.mimeType = "text/html"_s;
            auto htmlUtf8 = html->utf8();
            clipData.data.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(htmlUtf8.data()), htmlUtf8.length()));
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

void readRTFAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        auto rtf = readRTF(error);
        Vector<ClipboardData> data;
        
        if (rtf.has_value() && !rtf->isEmpty()) {
            ClipboardData clipData;
            clipData.type = DataType::RTF;
            clipData.mimeType = "text/rtf"_s;
            auto rtfUtf8 = rtf->utf8();
            clipData.data.append(std::span<const uint8_t>(reinterpret_cast<const uint8_t*>(rtfUtf8.data()), rtfUtf8.length()));
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

void readImageAsync(ReadCallback callback) {
    std::thread([callback = std::move(callback)]() {
        Error error;
        String mimeType;
        auto imageData = readImage(error, mimeType);
        Vector<ClipboardData> data;
        
        if (imageData.has_value()) {
            ClipboardData clipData;
            clipData.type = DataType::Image;
            clipData.mimeType = mimeType;
            clipData.data = WTFMove(*imageData);
            data.append(WTFMove(clipData));
        }
        
        callback(error, WTFMove(data));
    }).detach();
}

} // namespace Clipboard
} // namespace Bun

#endif // OS(WINDOWS)