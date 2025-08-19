#include "root.h"

#if OS(DARWIN)

#include "Clipboard.h"
#include <dlfcn.h>
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <wtf/NeverDestroyed.h>
#include <thread>
#include <CoreFoundation/CoreFoundation.h>

namespace Bun {
namespace Clipboard {

using namespace WTF;

// AppKit C API function pointers loaded dynamically
struct AppKitAPI {
    void* appkit_handle;
    void* foundation_handle;
    
    // Function pointers
    void* (*NSPasteboardGeneralPasteboard)(void);
    int (*NSPasteboardClearContents)(void* pasteboard);
    int (*NSPasteboardSetStringForType)(void* pasteboard, CFStringRef string, CFStringRef type);
    int (*NSPasteboardSetDataForType)(void* pasteboard, CFDataRef data, CFStringRef type);
    CFStringRef (*NSPasteboardStringForType)(void* pasteboard, CFStringRef type);
    CFDataRef (*NSPasteboardDataForType)(void* pasteboard, CFStringRef type);
    
    // Type constants
    CFStringRef NSPasteboardTypeString;
    CFStringRef NSPasteboardTypeHTML;
    CFStringRef NSPasteboardTypeRTF;
    CFStringRef NSPasteboardTypePNG;
    CFStringRef NSPasteboardTypeTIFF;
    
    bool loaded;
    
    AppKitAPI() : appkit_handle(nullptr), foundation_handle(nullptr), loaded(false) {}
    
    bool load() {
        if (loaded) return true;
        
        // Load Foundation framework
        foundation_handle = dlopen("/System/Library/Frameworks/Foundation.framework/Foundation", RTLD_LAZY);
        if (!foundation_handle) {
            return false;
        }
        
        // Load AppKit framework
        appkit_handle = dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", RTLD_LAZY);
        if (!appkit_handle) {
            dlclose(foundation_handle);
            foundation_handle = nullptr;
            return false;
        }
        
        // Try to load AppKit C functions (these may not exist in all macOS versions)
        NSPasteboardGeneralPasteboard = (void*(*)(void))dlsym(appkit_handle, "NSPasteboardGeneralPasteboard");
        NSPasteboardClearContents = (int(*)(void*))dlsym(appkit_handle, "NSPasteboardClearContents");
        NSPasteboardSetStringForType = (int(*)(void*, CFStringRef, CFStringRef))dlsym(appkit_handle, "NSPasteboardSetStringForType");
        NSPasteboardSetDataForType = (int(*)(void*, CFDataRef, CFStringRef))dlsym(appkit_handle, "NSPasteboardSetDataForType");
        NSPasteboardStringForType = (CFStringRef(*)(void*, CFStringRef))dlsym(appkit_handle, "NSPasteboardStringForType");
        NSPasteboardDataForType = (CFDataRef(*)(void*, CFStringRef))dlsym(appkit_handle, "NSPasteboardDataForType");
        
        // Load type constants
        void* ptr;
        ptr = dlsym(appkit_handle, "NSPasteboardTypeString");
        if (ptr) NSPasteboardTypeString = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypeHTML");
        if (ptr) NSPasteboardTypeHTML = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypeRTF");
        if (ptr) NSPasteboardTypeRTF = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypePNG");
        if (ptr) NSPasteboardTypePNG = *(CFStringRef*)ptr;
        
        ptr = dlsym(appkit_handle, "NSPasteboardTypeTIFF");
        if (ptr) NSPasteboardTypeTIFF = *(CFStringRef*)ptr;
        
        // If we can't load the C API, we'll fall back to pbcopy/pbpaste
        loaded = true;
        return true;
    }
    
    ~AppKitAPI() {
        if (appkit_handle) dlclose(appkit_handle);
        if (foundation_handle) dlclose(foundation_handle);
    }
};

static AppKitAPI* getAppKitAPI() {
    static LazyNeverDestroyed<AppKitAPI> api;
    static std::once_flag onceFlag;
    std::call_once(onceFlag, [&] {
        api.construct();
        api->load();
    });
    return &api.get();
}

// Fallback implementation using pbcopy/pbpaste command line tools
static bool executeCommand(const std::vector<const char*>& args, const std::string& input = "", std::string* output = nullptr) {
    int input_pipe[2] = {-1, -1};
    int output_pipe[2] = {-1, -1};
    
    // Create pipes if needed
    if (!input.empty() && pipe(input_pipe) == -1) {
        return false;
    }
    if (output && pipe(output_pipe) == -1) {
        if (input_pipe[0] != -1) {
            close(input_pipe[0]);
            close(input_pipe[1]);
        }
        return false;
    }
    
    // Build argv
    std::vector<char*> argv;
    for (const char* arg : args) {
        argv.push_back(const_cast<char*>(arg));
    }
    argv.push_back(nullptr);
    
    pid_t pid = fork();
    if (pid == -1) {
        // Fork failed
        if (input_pipe[0] != -1) {
            close(input_pipe[0]);
            close(input_pipe[1]);
        }
        if (output_pipe[0] != -1) {
            close(output_pipe[0]);
            close(output_pipe[1]);
        }
        return false;
    }
    
    if (pid == 0) {
        // Child process
        if (!input.empty()) {
            dup2(input_pipe[0], STDIN_FILENO);
            close(input_pipe[0]);
            close(input_pipe[1]);
        }
        if (output) {
            dup2(output_pipe[1], STDOUT_FILENO);
            close(output_pipe[0]);
            close(output_pipe[1]);
        }
        
        execvp(argv[0], argv.data());
        _exit(127);  // execvp failed
    }
    
    // Parent process - handle pipes
    if (!input.empty()) {
        close(input_pipe[0]);
        if (write(input_pipe[1], input.c_str(), input.length()) == -1) {
            // Handle write error - but continue
        }
        close(input_pipe[1]);
    }
    
    if (output) {
        close(output_pipe[1]);
        char buffer[4096];
        ssize_t bytes_read;
        output->clear();
        while ((bytes_read = read(output_pipe[0], buffer, sizeof(buffer))) > 0) {
            output->append(buffer, bytes_read);
        }
        close(output_pipe[0]);
    }
    
    // Wait for child process
    int status;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static void updateError(Error& err, const String& message) {
    err.type = ErrorType::PlatformError;
    err.message = message;
    err.code = -1;
}

static CFStringRef createCFString(const String& str) {
    auto utf8 = str.utf8();
    return CFStringCreateWithBytes(kCFAllocatorDefault, 
                                  reinterpret_cast<const UInt8*>(utf8.data()), 
                                  utf8.length(), 
                                  kCFStringEncodingUTF8, 
                                  false);
}

static String cfStringToWTFString(CFStringRef cfStr) {
    if (!cfStr) return String();
    
    CFIndex length = CFStringGetLength(cfStr);
    CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    
    Vector<char> buffer(maxSize);
    if (CFStringGetCString(cfStr, buffer.data(), maxSize, kCFStringEncodingUTF8)) {
        return String::fromUTF8(buffer.data());
    }
    return String();
}

// Native AppKit implementation (when available)
static Error writeTextNative(const String& text) {
    Error err;
    auto* api = getAppKitAPI();
    
    if (!api->NSPasteboardGeneralPasteboard || !api->NSPasteboardSetStringForType || !api->NSPasteboardTypeString) {
        updateError(err, "AppKit C API not available"_s);
        return err;
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(err, "Could not access pasteboard"_s);
        return err;
    }
    
    CFStringRef cfText = createCFString(text);
    if (!cfText) {
        updateError(err, "Failed to create CFString"_s);
        return err;
    }
    
    api->NSPasteboardClearContents(pasteboard);
    int success = api->NSPasteboardSetStringForType(pasteboard, cfText, api->NSPasteboardTypeString);
    
    CFRelease(cfText);
    
    if (!success) {
        updateError(err, "Failed to write text to pasteboard"_s);
    }
    
    return err;
}

static std::optional<String> readTextNative(Error& error) {
    error = Error{};
    auto* api = getAppKitAPI();
    
    if (!api->NSPasteboardGeneralPasteboard || !api->NSPasteboardStringForType || !api->NSPasteboardTypeString) {
        updateError(error, "AppKit C API not available"_s);
        return std::nullopt;
    }
    
    void* pasteboard = api->NSPasteboardGeneralPasteboard();
    if (!pasteboard) {
        updateError(error, "Could not access pasteboard"_s);
        return std::nullopt;
    }
    
    CFStringRef cfText = api->NSPasteboardStringForType(pasteboard, api->NSPasteboardTypeString);
    if (!cfText) {
        updateError(error, "No text found in pasteboard"_s);
        return std::nullopt;
    }
    
    String result = cfStringToWTFString(cfText);
    return result;
}

// Fallback implementation using pbcopy/pbpaste
static Error writeTextFallback(const String& text) {
    Error err;
    auto utf8Data = text.utf8();
    std::string textData(utf8Data.data(), utf8Data.length());
    
    bool success = executeCommand({"pbcopy"}, textData);
    if (!success) {
        updateError(err, "Failed to write text to clipboard using pbcopy"_s);
    }
    return err;
}

static std::optional<String> readTextFallback(Error& error) {
    error = Error{};
    std::string output;
    
    bool success = executeCommand({"pbpaste"}, "", &output);
    if (!success) {
        updateError(error, "Failed to read text from clipboard using pbpaste"_s);
        return std::nullopt;
    }
    
    return String::fromUTF8(output.c_str());
}

// Public API implementations
Error writeText(const String& text) {
    // Try native implementation first, fall back to pbcopy
    Error err = writeTextNative(text);
    if (err.type == ErrorType::None) {
        return err;
    }
    
    return writeTextFallback(text);
}

Error writeHTML(const String& html) {
    // For now, just write as plain text - HTML clipboard support requires more complex setup
    return writeText(html);
}

Error writeRTF(const String& rtf) {
    // For now, just write as plain text - RTF clipboard support requires more complex setup
    return writeText(rtf);
}

Error writeImage(const Vector<uint8_t>& imageData, const String& mimeType) {
    Error err;
    err.type = ErrorType::NotSupported;
    err.message = "Image clipboard operations not yet implemented on macOS"_s;
    return err;
}

std::optional<String> readText(Error& error) {
    // Try native implementation first, fall back to pbpaste
    auto result = readTextNative(error);
    if (error.type == ErrorType::None && result.has_value()) {
        return result;
    }
    
    return readTextFallback(error);
}

std::optional<String> readHTML(Error& error) {
    // For now, just read as plain text
    return readText(error);
}

std::optional<String> readRTF(Error& error) {
    // For now, just read as plain text
    return readText(error);
}

std::optional<Vector<uint8_t>> readImage(Error& error, String& mimeType) {
    error.type = ErrorType::NotSupported;
    error.message = "Image clipboard operations not yet implemented on macOS"_s;
    return std::nullopt;
}

bool isSupported() {
    // Check if either native API or pbcopy/pbpaste is available
    auto* api = getAppKitAPI();
    if (api->NSPasteboardGeneralPasteboard) {
        return true;
    }
    
    // Check if pbcopy is available
    return system("which pbcopy > /dev/null 2>&1") == 0;
}

Vector<DataType> getSupportedTypes() {
    Vector<DataType> types;
    if (isSupported()) {
        types.append(DataType::Text);
        types.append(DataType::HTML);
        types.append(DataType::RTF);
        // Image support can be added later
    }
    return types;
}

// Async implementations using std::thread
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

#endif // OS(DARWIN)