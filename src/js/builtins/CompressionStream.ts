// CompressionStream implementation
$getter;
export function readable(this: CompressionStream): ReadableStream {
  const stream = $getByIdDirectPrivate(this, "readable");
  if (!stream) throw $ERR_INVALID_THIS("CompressionStream");
  
  return stream as ReadableStream;
}

$getter;
export function writable(this: CompressionStream): WritableStream {
  const stream = $getByIdDirectPrivate(this, "writable");
  if (!stream) throw $ERR_INVALID_THIS("CompressionStream");
  
  return stream as WritableStream;
}

$constructor;
export function CompressionStream(this: CompressionStream, format: string = "gzip") {
  // This will be called from the C++ constructor
  // The C++ side will:
  // 1. Create the native Encoder
  // 2. Create the native Sink and link it to the Encoder
  // 3. Create a native-backed ReadableStream with the Encoder
  // 4. Create a native-backed WritableStream with the Sink
  // 5. Store both streams using putDirectPrivate
  
  // The constructor is implemented in C++, but we need this JS wrapper
  // to properly handle the format parameter and throw appropriate errors
  if (typeof format !== "string") {
    throw $ERR_INVALID_ARG_TYPE("format", "string", format);
  }
  
  // Validate format
  if (format !== "gzip" && format !== "deflate" && format !== "deflate-raw") {
    throw $ERR_INVALID_ARG_VALUE("format", format, "must be 'gzip', 'deflate', or 'deflate-raw'");
  }
  
  // The actual initialization happens in the C++ constructor
  // This is just a placeholder that will be replaced by the bindings
  return this;
}