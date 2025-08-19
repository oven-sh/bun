#pragma once

#include "root.h"
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/CString.h>
#include <optional>
#include <functional>

namespace Bun {
namespace Clipboard {

using namespace WTF;

enum class ErrorType {
    None,
    NotSupported,
    AccessDenied,
    PlatformError
};

struct Error {
    ErrorType type = ErrorType::None;
    String message;
    int code = 0;
};

// Supported clipboard data types
enum class DataType {
    Text,
    HTML,
    RTF,
    Image,
    Files
};

struct ClipboardData {
    DataType type;
    Vector<uint8_t> data;
    String mimeType;
};

// Async callback signature: (Error, Vector<ClipboardData>)
using ReadCallback = std::function<void(Error, Vector<ClipboardData>)>;
using WriteCallback = std::function<void(Error)>;

// Platform-specific implementations
Error writeText(const String& text);
Error writeHTML(const String& html);
Error writeRTF(const String& rtf);
Error writeImage(const Vector<uint8_t>& imageData, const String& mimeType);

std::optional<String> readText(Error& error);
std::optional<String> readHTML(Error& error);
std::optional<String> readRTF(Error& error);
std::optional<Vector<uint8_t>> readImage(Error& error, String& mimeType);

// Async versions for thread pool execution
void writeTextAsync(const String& text, WriteCallback callback);
void writeHTMLAsync(const String& html, WriteCallback callback);
void writeRTFAsync(const String& rtf, WriteCallback callback);
void writeImageAsync(const Vector<uint8_t>& imageData, const String& mimeType, WriteCallback callback);

void readTextAsync(ReadCallback callback);
void readHTMLAsync(ReadCallback callback);
void readRTFAsync(ReadCallback callback);
void readImageAsync(ReadCallback callback);

// Internal async task implementations
void executeWriteTextAsync(const String& text, WriteCallback callback);
void executeWriteHTMLAsync(const String& html, WriteCallback callback);
void executeWriteRTFAsync(const String& rtf, WriteCallback callback);
void executeWriteImageAsync(const Vector<uint8_t>& imageData, const String& mimeType, WriteCallback callback);

void executeReadTextAsync(ReadCallback callback);
void executeReadHTMLAsync(ReadCallback callback);
void executeReadRTFAsync(ReadCallback callback);
void executeReadImageAsync(ReadCallback callback);

// Check if clipboard operations are supported
bool isSupported();
Vector<DataType> getSupportedTypes();

} // namespace Clipboard
} // namespace Bun