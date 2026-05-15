# LLDB Pretty Printers for Bun

This directory contains LLDB pretty printers for various Bun data structures to improve the debugging experience.

## Files

- `bun_pretty_printer.py` - Pretty printers for Bun-specific types (`bun.String`, `WTFStringImpl`, `BabyList`, etc.)
- `lldb_webkit.py` - Pretty printers for WebKit/JavaScriptCore types
- `init.lldb` - LLDB initialization commands

## Supported Types

### bun.String Types

- `bun.String` (or just `String`) - The main Bun string type
- `WTFStringImpl` - WebKit string implementation (Latin1/UTF16)
- `UnsafeStringView` - Tagged-pointer string view (UTF8/Latin1/UTF16)

### Display Format

The pretty printers show string content directly, with additional metadata:

```
# bun.String examples:
"Hello, World!" [latin1]          # Regular string view
"UTF-8 String 🎉" [utf8]          # UTF-8 encoded
"Static content" [latin1 static]  # Static string
""                                # Empty string
<dead>                            # Dead/invalid string

# WTFStringImpl examples:
"WebKit String"                   # Shows the actual string content

# UnsafeStringView examples:
"Some text" [utf16 global]        # UTF16 globally allocated
"ASCII text" [latin1]             # Latin1 encoded
```

## Usage

### Option 1: Manual Loading

In your LLDB session:

```lldb
command script import /path/to/bun/misctools/lldb/bun_pretty_printer.py
```

### Option 2: Add to ~/.lldbinit

Add the following line to your `~/.lldbinit` file to load automatically:

```lldb
command script import /path/to/bun/misctools/lldb/bun_pretty_printer.py
```

### Option 3: Use init.lldb

```lldb
command source /path/to/bun/misctools/lldb/init.lldb
```

## Testing

To test the pretty printers:

1. Build a debug version of Bun:

```bash
bun bd
```

2. Create a test file that uses bun.String types

3. Debug with LLDB:

```bash
lldb ./build/debug/bun-debug
(lldb) command script import misctools/lldb/bun_pretty_printer.py
(lldb) breakpoint set --name <function name>
(lldb) run your_test.ts
(lldb) frame variable
```

## Implementation Details

### UnsafeStringView Pointer Tagging

`UnsafeStringView` uses pointer tagging in the upper bits:

- Bit 63: 1 = UTF16, 0 = UTF8/Latin1
- Bit 62: 1 = Globally allocated (mimalloc)
- Bit 61: 1 = UTF8 encoding
- Bit 60: 1 = Static/immortal

The pretty printer automatically detects and handles these tags.

### WTFStringImpl Encoding

WTFStringImpl uses flags in `m_hashAndFlags`:

- Bit 2 (s_hashFlag8BitBuffer): 1 = Latin1, 0 = UTF16

### bun.String Tag Union

`bun.String` is a tagged union with these variants:

- Dead (0): Invalid/freed string
- WTFStringImpl (1): WebKit string
- UnsafeStringView (2): Regular string view
- StaticUnsafeStringView (3): Static/immortal string
- Empty (4): Empty string ""

## Troubleshooting

If the pretty printers don't work:

1. Verify the Python script loaded:

```lldb
(lldb) script print("Python works")
```

2. Check if the category is enabled:

```lldb
(lldb) type category list
```

3. Enable the Bun category manually:

```lldb
(lldb) type category enable bun
```

4. For debugging the pretty printer itself, check for exceptions:

- The pretty printers catch all exceptions and return `<error>`
- Modify the code to print exceptions for debugging
