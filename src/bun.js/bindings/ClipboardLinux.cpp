#include "root.h"
#include "Clipboard.h"
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <thread>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>

#if OS(LINUX)
extern "C" ssize_t posix_spawn_bun(
    int* pid,
    const char* path,
    const struct bun_spawn_request_t* request,
    char* const argv[],
    char* const envp[]
);

// From bun-spawn.cpp
enum FileActionType : uint8_t {
    None,
    Close,
    Dup2,
    Open,
};

typedef struct bun_spawn_request_file_action_t {
    FileActionType type;
    const char* path;
    int fds[2];
    int flags;
    int mode;
} bun_spawn_request_file_action_t;

typedef struct bun_spawn_file_action_list_t {
    const bun_spawn_request_file_action_t* ptr;
    size_t len;
} bun_spawn_file_action_list_t;

typedef struct bun_spawn_request_t {
    const char* chdir;
    bool detached;
    bun_spawn_file_action_list_t actions;
} bun_spawn_request_t;
#endif

namespace Bun {
namespace Clipboard {

using namespace WTF;

enum class ClipboardBackend {
    None,
    XClip,     // For X11 environments
    WlClip     // For Wayland environments
};

static ClipboardBackend detected_backend = ClipboardBackend::None;
static bool backend_detection_done = false;

static ClipboardBackend detectClipboardBackend() {
    if (backend_detection_done) return detected_backend;
    backend_detection_done = true;
    
    // Check for Wayland first
    const char* wayland_display = getenv("WAYLAND_DISPLAY");
    if (wayland_display && strlen(wayland_display) > 0) {
        // Check if wl-copy is available
        if (system("command -v wl-copy > /dev/null 2>&1") == 0) {
            detected_backend = ClipboardBackend::WlClip;
            return detected_backend;
        }
    }
    
    // Check for X11
    const char* x11_display = getenv("DISPLAY");
    if (x11_display && strlen(x11_display) > 0) {
        // Check if xclip is available
        if (system("command -v xclip > /dev/null 2>&1") == 0) {
            detected_backend = ClipboardBackend::XClip;
            return detected_backend;
        }
    }
    
    detected_backend = ClipboardBackend::None;
    return detected_backend;
}

#if OS(LINUX)
// Execute command using Bun's spawn infrastructure
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
    
    // Set up file actions for bun_spawn
    std::vector<bun_spawn_request_file_action_t> file_actions;
    
    if (!input.empty()) {
        bun_spawn_request_file_action_t action = {};
        action.type = FileActionType::Dup2;
        action.fds[0] = input_pipe[0];  // source fd
        action.fds[1] = STDIN_FILENO;   // target fd
        file_actions.push_back(action);
        
        // Close write end in child
        bun_spawn_request_file_action_t close_action = {};
        close_action.type = FileActionType::Close;
        close_action.fds[0] = input_pipe[1];
        file_actions.push_back(close_action);
    }
    
    if (output) {
        bun_spawn_request_file_action_t action = {};
        action.type = FileActionType::Dup2;
        action.fds[0] = output_pipe[1];  // source fd
        action.fds[1] = STDOUT_FILENO;   // target fd
        file_actions.push_back(action);
        
        // Close read end in child
        bun_spawn_request_file_action_t close_action = {};
        close_action.type = FileActionType::Close;
        close_action.fds[0] = output_pipe[0];
        file_actions.push_back(close_action);
    }
    
    bun_spawn_file_action_list_t action_list = {
        .ptr = file_actions.empty() ? nullptr : file_actions.data(),
        .len = file_actions.size()
    };
    
    bun_spawn_request_t request = {
        .chdir = nullptr,
        .detached = false,
        .actions = action_list
    };
    
    // Build argv
    std::vector<char*> argv;
    for (const char* arg : args) {
        argv.push_back(const_cast<char*>(arg));
    }
    argv.push_back(nullptr);
    
    int pid;
    ssize_t spawn_result = posix_spawn_bun(&pid, args[0], &request, argv.data(), nullptr);
    
    if (spawn_result != 0) {
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
    
    // Parent process - handle pipes
    if (!input.empty()) {
        close(input_pipe[0]);
        if (write(input_pipe[1], input.c_str(), input.length()) == -1) {
            // Handle write error
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
#else
// Fallback for non-Linux platforms - use basic system() calls
static bool executeCommand(const std::vector<const char*>& args, const std::string& input = "", std::string* output = nullptr) {
    // This is a simplified fallback - not used on Linux
    return false;
}
#endif

// Simple clipboard operations using external tools
static bool writeToClipboard(const std::string& data, const std::string& mime_type = "text/plain") {
    ClipboardBackend backend = detectClipboardBackend();
    
    switch (backend) {
        case ClipboardBackend::XClip: {
            std::vector<const char*> args;
            if (mime_type == "text/html") {
                args = {"xclip", "-selection", "clipboard", "-t", "text/html"};
            } else if (mime_type == "text/rtf") {
                args = {"xclip", "-selection", "clipboard", "-t", "text/rtf"};
            } else {
                args = {"xclip", "-selection", "clipboard"};
            }
            return executeCommand(args, data);
        }
        case ClipboardBackend::WlClip: {
            std::vector<const char*> args;
            if (mime_type == "text/html") {
                args = {"wl-copy", "-t", "text/html"};
            } else if (mime_type == "text/rtf") {
                args = {"wl-copy", "-t", "text/rtf"};
            } else {
                args = {"wl-copy"};
            }
            return executeCommand(args, data);
        }
        case ClipboardBackend::None:
        default:
            return false;
    }
}

static std::optional<std::string> readFromClipboard(const std::string& mime_type = "text/plain") {
    ClipboardBackend backend = detectClipboardBackend();
    std::string output;
    
    switch (backend) {
        case ClipboardBackend::XClip: {
            std::vector<const char*> args;
            if (mime_type == "text/html") {
                args = {"xclip", "-selection", "clipboard", "-o", "-t", "text/html"};
            } else if (mime_type == "text/rtf") {
                args = {"xclip", "-selection", "clipboard", "-o", "-t", "text/rtf"};
            } else {
                args = {"xclip", "-selection", "clipboard", "-o"};
            }
            if (executeCommand(args, "", &output)) {
                return output;
            }
            break;
        }
        case ClipboardBackend::WlClip: {
            std::vector<const char*> args;
            if (mime_type == "text/html") {
                args = {"wl-paste", "-t", "text/html"};
            } else if (mime_type == "text/rtf") {
                args = {"wl-paste", "-t", "text/rtf"};
            } else {
                args = {"wl-paste"};
            }
            if (executeCommand(args, "", &output)) {
                return output;
            }
            break;
        }
        case ClipboardBackend::None:
        default:
            break;
    }
    
    return std::nullopt;
}

// Public API implementations
Error writeText(const String& text) {
    Error err;
    auto utf8Data = text.utf8();
    std::string textData(utf8Data.data(), utf8Data.length());
    
    bool success = writeToClipboard(textData, "text/plain");
    err.type = success ? ErrorType::None : ErrorType::PlatformError;
    if (!success) {
        err.message = "Failed to write text to clipboard"_s;
    }
    return err;
}

Error writeHTML(const String& html) {
    Error err;
    auto utf8Data = html.utf8();
    std::string htmlData(utf8Data.data(), utf8Data.length());
    
    bool success = writeToClipboard(htmlData, "text/html");
    err.type = success ? ErrorType::None : ErrorType::PlatformError;
    if (!success) {
        err.message = "Failed to write HTML to clipboard"_s;
    }
    return err;
}

Error writeRTF(const String& rtf) {
    Error err;
    auto utf8Data = rtf.utf8();
    std::string rtfData(utf8Data.data(), utf8Data.length());
    
    bool success = writeToClipboard(rtfData, "text/rtf");
    err.type = success ? ErrorType::None : ErrorType::PlatformError;
    if (!success) {
        err.message = "Failed to write RTF to clipboard"_s;
    }
    return err;
}

Error writeImage(const Vector<uint8_t>& imageData, const String& mimeType) {
    Error err;
    err.type = ErrorType::NotSupported;
    err.message = "Image clipboard operations not yet implemented on Linux"_s;
    return err;
}

std::optional<String> readText(Error& error) {
    auto result = readFromClipboard("text/plain");
    if (!result.has_value()) {
        error.type = ErrorType::PlatformError;
        error.message = "Failed to read text from clipboard"_s;
        return std::nullopt;
    }
    
    error.type = ErrorType::None;
    return String::fromUTF8(std::span<const unsigned char>(reinterpret_cast<const unsigned char*>(result->c_str()), result->length()));
}

std::optional<String> readHTML(Error& error) {
    auto result = readFromClipboard("text/html");
    if (!result.has_value()) {
        error.type = ErrorType::PlatformError;
        error.message = "Failed to read HTML from clipboard"_s;
        return std::nullopt;
    }
    
    error.type = ErrorType::None;
    return String::fromUTF8(std::span<const unsigned char>(reinterpret_cast<const unsigned char*>(result->c_str()), result->length()));
}

std::optional<String> readRTF(Error& error) {
    auto result = readFromClipboard("text/rtf");
    if (!result.has_value()) {
        error.type = ErrorType::PlatformError;
        error.message = "Failed to read RTF from clipboard"_s;
        return std::nullopt;
    }
    
    error.type = ErrorType::None;
    return String::fromUTF8(std::span<const unsigned char>(reinterpret_cast<const unsigned char*>(result->c_str()), result->length()));
}

std::optional<Vector<uint8_t>> readImage(Error& error, String& mimeType) {
    error.type = ErrorType::NotSupported;
    error.message = "Image clipboard operations not yet implemented on Linux"_s;
    return std::nullopt;
}

bool isSupported() {
    return detectClipboardBackend() != ClipboardBackend::None;
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