// Objective-C runtime headers without the extern
// intended for dlopen

const std = @import("std");

pub const ObjC = struct {
    // copypasta because the autocomplete for it is broken
    pub const DlDynlib = struct {
        const os = std.os;
        const system = std.os.system;

        pub const Error = error{FileNotFound};

        handle: *anyopaque,

        pub fn open(path: []const u8) !DlDynlib {
            const path_c = try os.toPosixPath(path);
            return openZ(&path_c);
        }

        pub fn openZ(path_c: [*:0]const u8) !DlDynlib {
            return DlDynlib{
                .handle = system.dlopen(path_c, system.RTLD.LAZY) orelse {
                    return error.FileNotFound;
                },
            };
        }

        pub fn close(self: *DlDynlib) void {
            _ = system.dlclose(self.handle);
            self.* = undefined;
        }

        pub fn lookup(self: *DlDynlib, comptime T: type, name: [:0]const u8) ?T {
            // dlsym (and other dl-functions) secretly take shadow parameter - return address on stack
            // https://gcc.gnu.org/bugzilla/show_bug.cgi?id=66826
            if (@call(.{ .modifier = .never_tail }, system.dlsym, .{ self.handle, name.ptr })) |symbol| {
                @setRuntimeSafety(false);
                return @ptrCast(T, @alignCast(@alignOf(T), symbol));
            } else {
                return null;
            }
        }
    };

    pub const C = struct {
        objc_lookUpClass: Types.objc_lookUpClass,
        sel_getUid: Types.sel_getUid,
        objc_msgSend: fn (...) callconv(.C) Types.id,
        objc_dylib: DlDynlib,
        appkit_dylib: DlDynlib,
        CFStringCreateWithBytesNoCopy: Types.CFStringCreateWithBytesNoCopy,
        NSPasteboardTypeString: Types.CFStringRef,
        NSPasteboardTypePNG: Types.CFStringRef,
        // NSPasteboardTypeURL: *Types.id,
        CFArrayCreate: Types.CFArrayCreate,
        kCFAllocatorNull: Types.kCFAllocatorNull,
        CFArrayContainsValue: Types.CFArrayContainsValue,
        CFRetain: Types.CFRetain,
        CFRelease: Types.CFRelease,
        CFDataGetLength: Types.CFDataGetLength,
        CFDataGetBytePtr: Types.CFDataGetBytePtr,
        CFDataCreateWithBytesNoCopy: Types.CFDataCreateWithBytesNoCopy,
        CFArrayGetCount: Types.CFArrayGetCount,
        CFArrayGetValueAtIndex: Types.CFArrayGetValueAtIndex,

        const id = Types.id;

        pub fn class(c: *C, s: [*c]const u8) Types.id {
            return @ptrCast(C.id, @alignCast(@alignOf(C.id), c.objc_lookUpClass(s)));
        }

        pub fn call(c: *C, obj: Types.id, sel_name: [*c]const u8) Types.id {
            var f = @ptrCast(
                fn (C.id, Types.SEL) callconv(.C) C.id,
                c.objc_msgSend,
            );
            return f(obj, c.sel_getUid(sel_name));
        }

        pub fn call_(c: *C, obj: Types.id, sel_name: [*c]const u8, arg: anytype) C.id {
            //  objc_msgSend has the prototype "void objc_msgSend(void)",
            //  so we have to cast it based on the types of our arguments
            //  (https://www.mikeash.com/pyblog/objc_msgsends-new-prototype.html)
            var f = @ptrCast(
                fn (Types.id, Types.SEL, @TypeOf(arg)) callconv(.C) Types.id,
                c.objc_msgSend,
            );
            return f(obj, c.sel_getUid(sel_name), arg);
        }

        pub fn call2(c: *C, obj: Types.id, sel_name: [*c]const u8, arg: anytype, arg2: anytype) C.id {
            //  objc_msgSend has the prototype "void objc_msgSend(void)",
            //  so we have to cast it based on the types of our arguments
            //  (https://www.mikeash.com/pyblog/objc_msgsends-new-prototype.html)
            var f = @ptrCast(
                fn (Types.id, Types.SEL, @TypeOf(arg), @TypeOf(arg2)) callconv(.C) C.id,
                c.objc_msgSend,
            );
            return f(obj, c.sel_getUid(sel_name), arg, arg2);
        }
    };

    pub const Clipboard = struct {
        pub const Data = enum {
            png,
            string,
            // url,
        };
        pub fn get(allocator: std.mem.Allocator, tag: Data) ![]u8 {
            if (!objc_loaded) {
                try load();
            }

            const pasteboard_class = objc.class("NSPasteboard");
            const pb = objc.call(pasteboard_class, "generalPasteboard");
            var kind = switch (tag) {
                .png => objc.NSPasteboardTypePNG,
                .string => objc.NSPasteboardTypeString,
                // .url => objc.NSPasteboardTypeURL,
            };
            var array = [_]?*const anyopaque{kind};
            var supported_types = objc.CFArrayCreate(null, &array, 1, null);
            defer objc.CFRelease(supported_types);
            const item = objc.call_(pb, "availableTypeFromArray:", supported_types.toNSArray());
            const data = objc.call_(
                item,
                "dataForType:",
                @ptrCast(Types.id, @alignCast(@alignOf(Types.id), kind)),
            );
            const size: usize = @ptrToInt(objc.call(data, "length"));
            if (size == 0)
                return &[_]u8{};

            var bytes = try allocator.alloc(u8, size);
            _ = objc.call2(data, "getBytes:length:", bytes.ptr, size);
            return bytes;
        }

        pub fn set(tag: Data, blob: []const u8) !void {
            if (!objc_loaded) {
                try load();
            }

            const pasteboard_class = objc.class("NSPasteboard");
            const pb = objc.call(pasteboard_class, "generalPasteboard");

            const NSData = objc.class("NSData");
            var data = objc.call2(NSData, "dataWithBytes:length", blob.ptr, blob.len);
            var kind = switch (tag) {
                .png => objc.NSPasteboardTypePNG,
                .string => objc.NSPasteboardTypeString,
                // .url => objc.NSPasteboardTypeURL,
            };
            _ = objc.call2(pb, "declareTypes:owner", kind, @as(Types.id, null));

            _ = objc.call2(
                pb,
                "setData:forType",
                data,
                @ptrCast(Types.id, @alignCast(@alignOf(Types.id), kind)),
            );
        }
    };

    pub var objc: C = undefined;
    pub var objc_loaded: bool = false;

    pub fn load() !void {
        var dylib = try DlDynlib.openZ("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
        var appkit = try DlDynlib.openZ("/System/Library/Frameworks/AppKit.framework/AppKit");
        var CFStringCreateWithBytesNoCopy = dylib.lookup(Types.CFStringCreateWithBytesNoCopy, "CFStringCreateWithBytesNoCopy").?;
        const kCFAllocatorNull = dylib.lookup(Types.kCFAllocatorNull, "kCFAllocatorNull").?;
        var NSPasteboardTypeString = CFStringCreateWithBytesNoCopy(
            null,
            "public.utf8-plain-text",
            "public.utf8-plain-text".len,
            Types.CFStringEncoding.ASCII,
            1,
            null,
        );
        var NSPasteboardTypePNG = CFStringCreateWithBytesNoCopy(
            null,
            "public.png",
            "public.png".len,
            Types.CFStringEncoding.ASCII,
            1,
            null,
        );

        objc = C{
            .kCFAllocatorNull = kCFAllocatorNull,

            .objc_lookUpClass = dylib.lookup(Types.objc_lookUpClass, "objc_lookUpClass").?,
            .sel_getUid = dylib.lookup(Types.sel_getUid, "sel_getUid").?,
            .objc_msgSend = dylib.lookup(fn (...) callconv(.C) C.id, "objc_msgSend").?,
            .appkit_dylib = appkit,
            .objc_dylib = dylib,
            .CFStringCreateWithBytesNoCopy = CFStringCreateWithBytesNoCopy,
            .NSPasteboardTypeString = NSPasteboardTypeString,
            .NSPasteboardTypePNG = NSPasteboardTypePNG,
            .CFArrayCreate = dylib.lookup(@TypeOf(objc.CFArrayCreate), "CFArrayCreate").?,
            .CFArrayContainsValue = dylib.lookup(@TypeOf(objc.CFArrayContainsValue), "CFArrayContainsValue").?,
            .CFRetain = dylib.lookup(@TypeOf(objc.CFRetain), "CFRetain").?,
            .CFRelease = dylib.lookup(@TypeOf(objc.CFRelease), "CFRelease").?,
            .CFDataGetLength = dylib.lookup(@TypeOf(objc.CFDataGetLength), "CFDataGetLength").?,
            .CFDataGetBytePtr = dylib.lookup(@TypeOf(objc.CFDataGetBytePtr), "CFDataGetBytePtr").?,
            .CFDataCreateWithBytesNoCopy = dylib.lookup(@TypeOf(objc.CFDataCreateWithBytesNoCopy), "CFDataCreateWithBytesNoCopy").?,
            .CFArrayGetCount = dylib.lookup(@TypeOf(objc.CFArrayGetCount), "CFArrayGetCount").?,
            .CFArrayGetValueAtIndex = dylib.lookup(@TypeOf(objc.CFArrayGetValueAtIndex), "CFArrayGetValueAtIndex").?,
        };
        objc_loaded = true;
    }

    pub const Types = struct {
        pub const CFRange = extern struct {
            location: CFIndex,
            length: CFIndex,
        };
        const UInt8 = u8;
        pub const CFData = opaque {
            pub fn init(objc_id: id) *CFData {
                return @ptrCast(*CFData, objc_id.isa.?);
            }
        };
        const UInt32 = u32;
        pub const CFStringEncoding = enum(UInt32) {
            MacRoman = 0,
            WindowsLatin1 = 1280,
            ISOLatin1 = 513,
            NextStepLatin = 2817,
            ASCII = 1536,
            UTF8 = 134217984,
            NonLossyASCII = 3071,
            UTF16 = 256,
            UTF16BE = 268435712,
            UTF16LE = 335544576,
            UTF32 = 201326848,
            UTF32BE = 402653440,
            UTF32LE = 469762304,
            _,
        };
        pub const CFStringBuiltInEncodings = CFStringEncoding;
        pub const CFStringCreateWithBytesNoCopy = fn (alloc: CFAllocatorRef, bytes: [*]const UInt8, numBytes: CFIndex, encoding: CFStringEncoding, isExternalRepresentation: Boolean, contentsDeallocator: CFAllocatorRef) callconv(.C) CFStringRef;

        pub const CFDataRef = ?*const CFData;
        pub const CFArrayCreate = fn (allocator: CFAllocatorRef, values: [*]?*const anyopaque, numValues: CFIndex, callBacks: ?*const CFArrayCallBacks) callconv(.C) CFArrayRef;
        pub const CFArrayContainsValue = fn (theArray: CFArrayRef, range: CFRange, value: ?*const anyopaque) callconv(.C) Boolean;
        pub const CFRetain = fn (cf: CFTypeRef) callconv(.C) CFTypeRef;
        pub const CFRelease = fn (cf: CFTypeRef) callconv(.C) void;
        pub const CFDataGetLength = fn (theData: CFDataRef) callconv(.C) CFIndex;
        pub const CFDataGetBytePtr = fn (theData: CFDataRef) callconv(.C) [*c]const UInt8;
        pub const CFDataCreateWithBytesNoCopy = fn (allocator: CFAllocatorRef, bytes: [*c]const UInt8, length: CFIndex, bytesDeallocator: CFAllocatorRef) callconv(.C) CFDataRef;
        pub const Boolean = u8;
        pub const CFTypeRef = ?*anyopaque;
        pub const struct___CFAllocator = opaque {};
        pub const CFAllocatorRef = ?*const struct___CFAllocator;
        pub const CFString = opaque {};
        pub const CFStringRef = *CFString;

        pub const kCFAllocatorNull = CFAllocatorRef;
        pub const CFArrayRetainCallBack = ?fn (CFAllocatorRef, ?*const anyopaque) callconv(.C) ?*const anyopaque;
        pub const CFArrayReleaseCallBack = ?fn (CFAllocatorRef, ?*const anyopaque) callconv(.C) void;
        pub const CFArrayCopyDescriptionCallBack = ?fn (?*const anyopaque) callconv(.C) CFStringRef;
        pub const CFArrayEqualCallBack = ?fn (?*const anyopaque, ?*const anyopaque) callconv(.C) Boolean;
        pub const CFArrayCallBacks = extern struct {
            version: CFIndex,
            retain: CFArrayRetainCallBack,
            release: CFArrayReleaseCallBack,
            copyDescription: CFArrayCopyDescriptionCallBack,
            equal: CFArrayEqualCallBack,
        };
        pub extern const kCFTypeArrayCallBacks: CFArrayCallBacks;
        pub const CFArrayApplierFunction = ?fn (?*const anyopaque, ?*anyopaque) callconv(.C) void;
        pub const CFArray = opaque {
            pub fn toNSArray(this: *CFArray) id {
                return @ptrCast(id, @alignCast(@alignOf(id), this));
            }
        };
        pub const CFArrayRef = *CFArray;
        pub const CFMutableArrayRef = ?*CFArray;
        pub const CFArrayGetCount = fn (theArray: CFArrayRef) callconv(.C) CFIndex;
        pub const CFArrayGetValueAtIndex = fn (theArray: CFArrayRef, idx: CFIndex) callconv(.C) ?*const anyopaque;
        pub const CFIndex = c_long;

        pub const struct_objc_class = opaque {};
        pub const Class = ?*struct_objc_class;
        pub const struct_objc_object = extern struct {
            isa: Class,
        };
        pub const id = ?*struct_objc_object;
        pub const struct_objc_selector = opaque {};
        pub const SEL = ?*struct_objc_selector;
        pub const IMP = ?fn () callconv(.C) void;
        pub const BOOL = bool;
        pub const objc_objectptr_t = ?*const anyopaque;

        pub const arith_t = c_long;
        pub const uarith_t = c_ulong;
        pub const STR = [*c]u8;
        pub const ptrdiff_t = c_long;
        pub const wchar_t = c_int;
        pub const max_align_t = c_longdouble;
        pub const struct_objc_method = opaque {};
        pub const Method = ?*struct_objc_method;
        pub const struct_objc_ivar = opaque {};
        pub const Ivar = ?*struct_objc_ivar;
        pub const struct_objc_category = opaque {};
        pub const Category = ?*struct_objc_category;
        pub const struct_objc_property = opaque {};
        pub const objc_property_t = ?*struct_objc_property;
        pub const Protocol = struct_objc_object;
        pub const struct_objc_method_description = extern struct {
            name: SEL,
            types: [*c]u8,
        };
        pub const objc_property_attribute_t = extern struct {
            name: [*c]const u8,
            value: [*c]const u8,
        };

        pub const sel_getName = fn (sel: SEL) callconv(.C) [*c]const u8;
        pub const sel_registerName = fn (str: [*c]const u8) callconv(.C) SEL;
        pub const object_getClassName = fn (obj: id) callconv(.C) [*c]const u8;
        pub const object_getIndexedIvars = fn (obj: id) callconv(.C) ?*anyopaque;
        pub const sel_isMapped = fn (sel: SEL) callconv(.C) BOOL;
        pub const sel_getUid = fn (str: [*c]const u8) callconv(.C) SEL;
        pub const objc_retainedObject = fn (obj: objc_objectptr_t) callconv(.C) id;
        pub const objc_unretainedObject = fn (obj: objc_objectptr_t) callconv(.C) id;
        pub const objc_unretainedPointer = fn (obj: id) callconv(.C) objc_objectptr_t;
        pub const object_copy = fn (obj: id, size: usize) callconv(.C) id;
        pub const object_dispose = fn (obj: id) callconv(.C) id;
        pub const object_getClass = fn (obj: id) callconv(.C) Class;
        pub const object_setClass = fn (obj: id, cls: Class) callconv(.C) Class;
        pub const object_isClass = fn (obj: id) callconv(.C) BOOL;
        pub const object_getIvar = fn (obj: id, ivar: Ivar) callconv(.C) id;
        pub const object_setIvar = fn (obj: id, ivar: Ivar, value: id) callconv(.C) void;
        pub const object_setIvarWithStrongDefault = fn (obj: id, ivar: Ivar, value: id) callconv(.C) void;
        pub const object_setInstanceVariable = fn (obj: id, name: [*c]const u8, value: ?*anyopaque) callconv(.C) Ivar;
        pub const object_setInstanceVariableWithStrongDefault = fn (obj: id, name: [*c]const u8, value: ?*anyopaque) callconv(.C) Ivar;
        pub const object_getInstanceVariable = fn (obj: id, name: [*c]const u8, outValue: [*c]?*anyopaque) callconv(.C) Ivar;
        pub const objc_getClass = fn (name: [*c]const u8) callconv(.C) Class;
        pub const objc_getMetaClass = fn (name: [*c]const u8) callconv(.C) Class;
        pub const objc_lookUpClass = fn (name: [*c]const u8) callconv(.C) Class;
        pub const objc_getRequiredClass = fn (name: [*c]const u8) callconv(.C) Class;
        pub const objc_getClassList = fn (buffer: [*c]Class, bufferCount: c_int) callconv(.C) c_int;
        pub const objc_copyClassList = fn (outCount: [*c]c_uint) callconv(.C) [*c]Class;
        pub const class_getName = fn (cls: Class) callconv(.C) [*c]const u8;
        pub const class_isMetaClass = fn (cls: Class) callconv(.C) BOOL;
        pub const class_getSuperclass = fn (cls: Class) callconv(.C) Class;
        pub const class_setSuperclass = fn (cls: Class, newSuper: Class) callconv(.C) Class;
        pub const class_getVersion = fn (cls: Class) callconv(.C) c_int;
        pub const class_setVersion = fn (cls: Class, version: c_int) callconv(.C) void;
        pub const class_getInstanceSize = fn (cls: Class) callconv(.C) usize;
        pub const class_getInstanceVariable = fn (cls: Class, name: [*c]const u8) callconv(.C) Ivar;
        pub const class_getClassVariable = fn (cls: Class, name: [*c]const u8) callconv(.C) Ivar;
        pub const class_copyIvarList = fn (cls: Class, outCount: [*c]c_uint) callconv(.C) [*c]Ivar;
        pub const class_getInstanceMethod = fn (cls: Class, name: SEL) callconv(.C) Method;
        pub const class_getClassMethod = fn (cls: Class, name: SEL) callconv(.C) Method;
        pub const class_getMethodImplementation = fn (cls: Class, name: SEL) callconv(.C) IMP;
        pub const class_getMethodImplementation_stret = fn (cls: Class, name: SEL) callconv(.C) IMP;
        pub const class_respondsToSelector = fn (cls: Class, sel: SEL) callconv(.C) BOOL;
        pub const class_copyMethodList = fn (cls: Class, outCount: [*c]c_uint) callconv(.C) [*c]Method;
        pub const class_conformsToProtocol = fn (cls: Class, protocol: [*c]Protocol) callconv(.C) BOOL;
        pub const class_copyProtocolList = fn (cls: Class, outCount: [*c]c_uint) callconv(.C) [*c][*c]Protocol;
        pub const class_getProperty = fn (cls: Class, name: [*c]const u8) callconv(.C) objc_property_t;
        pub const class_copyPropertyList = fn (cls: Class, outCount: [*c]c_uint) callconv(.C) [*c]objc_property_t;
        pub const class_getIvarLayout = fn (cls: Class) callconv(.C) [*c]const u8;
        pub const class_getWeakIvarLayout = fn (cls: Class) callconv(.C) [*c]const u8;
        pub const class_addMethod = fn (cls: Class, name: SEL, imp: IMP, types: [*c]const u8) callconv(.C) BOOL;
        pub const class_replaceMethod = fn (cls: Class, name: SEL, imp: IMP, types: [*c]const u8) callconv(.C) IMP;
        pub const class_addIvar = fn (cls: Class, name: [*c]const u8, size: usize, alignment: u8, types: [*c]const u8) callconv(.C) BOOL;
        pub const class_addProtocol = fn (cls: Class, protocol: [*c]Protocol) callconv(.C) BOOL;
        pub const class_addProperty = fn (cls: Class, name: [*c]const u8, attributes: [*c]const objc_property_attribute_t, attributeCount: c_uint) callconv(.C) BOOL;
        pub const class_replaceProperty = fn (cls: Class, name: [*c]const u8, attributes: [*c]const objc_property_attribute_t, attributeCount: c_uint) callconv(.C) void;
        pub const class_setIvarLayout = fn (cls: Class, layout: [*c]const u8) callconv(.C) void;
        pub const class_setWeakIvarLayout = fn (cls: Class, layout: [*c]const u8) callconv(.C) void;
        pub const objc_getFutureClass = fn (name: [*c]const u8) callconv(.C) Class;
        pub const class_createInstance = fn (cls: Class, extraBytes: usize) callconv(.C) id;
        pub const objc_constructInstance = fn (cls: Class, bytes: ?*anyopaque) callconv(.C) id;
        pub const objc_destructInstance = fn (obj: id) callconv(.C) ?*anyopaque;
        pub const objc_allocateClassPair = fn (superclass: Class, name: [*c]const u8, extraBytes: usize) callconv(.C) Class;
        pub const objc_registerClassPair = fn (cls: Class) callconv(.C) void;
        pub const objc_duplicateClass = fn (original: Class, name: [*c]const u8, extraBytes: usize) callconv(.C) Class;
        pub const objc_disposeClassPair = fn (cls: Class) callconv(.C) void;
        pub const method_getName = fn (m: Method) callconv(.C) SEL;
        pub const method_getImplementation = fn (m: Method) callconv(.C) IMP;
        pub const method_getTypeEncoding = fn (m: Method) callconv(.C) [*c]const u8;
        pub const method_getNumberOfArguments = fn (m: Method) callconv(.C) c_uint;
        pub const method_copyReturnType = fn (m: Method) callconv(.C) [*c]u8;
        pub const method_copyArgumentType = fn (m: Method, index: c_uint) callconv(.C) [*c]u8;
        pub const method_getReturnType = fn (m: Method, dst: [*c]u8, dst_len: usize) callconv(.C) void;
        pub const method_getArgumentType = fn (m: Method, index: c_uint, dst: [*c]u8, dst_len: usize) callconv(.C) void;
        pub const method_getDescription = fn (m: Method) callconv(.C) [*c]struct_objc_method_description;
        pub const method_setImplementation = fn (m: Method, imp: IMP) callconv(.C) IMP;
        pub const method_exchangeImplementations = fn (m1: Method, m2: Method) callconv(.C) void;
        pub const ivar_getName = fn (v: Ivar) callconv(.C) [*c]const u8;
        pub const ivar_getTypeEncoding = fn (v: Ivar) callconv(.C) [*c]const u8;
        pub const ivar_getOffset = fn (v: Ivar) callconv(.C) ptrdiff_t;
        pub const property_getName = fn (property: objc_property_t) callconv(.C) [*c]const u8;
        pub const property_getAttributes = fn (property: objc_property_t) callconv(.C) [*c]const u8;
        pub const property_copyAttributeList = fn (property: objc_property_t, outCount: [*c]c_uint) callconv(.C) [*c]objc_property_attribute_t;
        pub const property_copyAttributeValue = fn (property: objc_property_t, attributeName: [*c]const u8) callconv(.C) [*c]u8;
        pub const objc_getProtocol = fn (name: [*c]const u8) callconv(.C) [*c]Protocol;
        pub const objc_copyProtocolList = fn (outCount: [*c]c_uint) callconv(.C) [*c][*c]Protocol;
        pub const protocol_conformsToProtocol = fn (proto: [*c]Protocol, other: [*c]Protocol) callconv(.C) BOOL;
        pub const protocol_isEqual = fn (proto: [*c]Protocol, other: [*c]Protocol) callconv(.C) BOOL;
        pub const protocol_getName = fn (proto: [*c]Protocol) callconv(.C) [*c]const u8;
        pub const protocol_getMethodDescription = fn (proto: [*c]Protocol, aSel: SEL, isRequiredMethod: BOOL, isInstanceMethod: BOOL) callconv(.C) struct_objc_method_description;
        pub const protocol_copyMethodDescriptionList = fn (proto: [*c]Protocol, isRequiredMethod: BOOL, isInstanceMethod: BOOL, outCount: [*c]c_uint) callconv(.C) [*c]struct_objc_method_description;
        pub const protocol_getProperty = fn (proto: [*c]Protocol, name: [*c]const u8, isRequiredProperty: BOOL, isInstanceProperty: BOOL) callconv(.C) objc_property_t;
        pub const protocol_copyPropertyList = fn (proto: [*c]Protocol, outCount: [*c]c_uint) callconv(.C) [*c]objc_property_t;
        pub const protocol_copyPropertyList2 = fn (proto: [*c]Protocol, outCount: [*c]c_uint, isRequiredProperty: BOOL, isInstanceProperty: BOOL) callconv(.C) [*c]objc_property_t;
        pub const protocol_copyProtocolList = fn (proto: [*c]Protocol, outCount: [*c]c_uint) callconv(.C) [*c][*c]Protocol;
        pub const objc_allocateProtocol = fn (name: [*c]const u8) callconv(.C) [*c]Protocol;
        pub const objc_registerProtocol = fn (proto: [*c]Protocol) callconv(.C) void;
        pub const protocol_addMethodDescription = fn (proto: [*c]Protocol, name: SEL, types: [*c]const u8, isRequiredMethod: BOOL, isInstanceMethod: BOOL) callconv(.C) void;
        pub const protocol_addProtocol = fn (proto: [*c]Protocol, addition: [*c]Protocol) callconv(.C) void;
        pub const protocol_addProperty = fn (proto: [*c]Protocol, name: [*c]const u8, attributes: [*c]const objc_property_attribute_t, attributeCount: c_uint, isRequiredProperty: BOOL, isInstanceProperty: BOOL) callconv(.C) void;
        pub const objc_copyImageNames = fn (outCount: [*c]c_uint) callconv(.C) [*c][*c]const u8;
        pub const class_getImageName = fn (cls: Class) callconv(.C) [*c]const u8;
        pub const objc_copyClassNamesForImage = fn (image: [*c]const u8, outCount: [*c]c_uint) callconv(.C) [*c][*c]const u8;
        pub const sel_isEqual = fn (lhs: SEL, rhs: SEL) callconv(.C) BOOL;
        pub const objc_enumerationMutation = fn (obj: id) callconv(.C) void;
        pub const objc_setEnumerationMutationHandler = fn (handler: ?fn (id) callconv(.C) void) callconv(.C) void;
        pub const objc_setForwardHandler = fn (fwd: ?*anyopaque, fwd_stret: ?*anyopaque) callconv(.C) void;
        pub const imp_implementationWithBlock = fn (block: id) callconv(.C) IMP;
        pub const imp_getBlock = fn (anImp: IMP) callconv(.C) id;
        pub const imp_removeBlock = fn (anImp: IMP) callconv(.C) BOOL;
        pub const objc_loadWeak = fn (location: [*c]id) callconv(.C) id;
        pub const objc_storeWeak = fn (location: [*c]id, obj: id) callconv(.C) id;
        pub const objc_AssociationPolicy = usize;
        pub const OBJC_ASSOCIATION_ASSIGN: c_int = 0;
        pub const OBJC_ASSOCIATION_RETAIN_NONATOMIC: c_int = 1;
        pub const OBJC_ASSOCIATION_COPY_NONATOMIC: c_int = 3;
        pub const OBJC_ASSOCIATION_RETAIN: c_int = 769;
        pub const OBJC_ASSOCIATION_COPY: c_int = 771;
        const enum_unnamed_1 = c_uint;
        pub const objc_setAssociatedObject = fn (object: id, key: ?*const anyopaque, value: id, policy: objc_AssociationPolicy) callconv(.C) void;
        pub const objc_getAssociatedObject = fn (object: id, key: ?*const anyopaque) callconv(.C) id;
        pub const objc_removeAssociatedObjects = fn (object: id) callconv(.C) void;
        pub const objc_hook_getImageName = ?fn (Class, [*c][*c]const u8) callconv(.C) BOOL;
        pub const objc_setHook_getImageName = fn (newValue: objc_hook_getImageName, outOldValue: [*c]objc_hook_getImageName) callconv(.C) void;
        pub const objc_hook_getClass = ?fn ([*c]const u8, [*c]Class) callconv(.C) BOOL;
        pub const objc_setHook_getClass = fn (newValue: objc_hook_getClass, outOldValue: [*c]objc_hook_getClass) callconv(.C) void;
        pub const struct_mach_header = opaque {};
        pub const objc_func_loadImage = ?fn (?*const struct_mach_header) callconv(.C) void;
        pub const objc_addLoadImageFunc = fn (func: objc_func_loadImage) callconv(.C) void;
        pub const objc_hook_lazyClassNamer = ?fn (Class) callconv(.C) [*c]const u8;
        pub const objc_setHook_lazyClassNamer = fn (newValue: objc_hook_lazyClassNamer, oldOutValue: [*c]objc_hook_lazyClassNamer) callconv(.C) void;
        pub const _objc_swiftMetadataInitializer = ?fn (Class, ?*anyopaque) callconv(.C) Class;
        pub const _objc_realizeClassFromSwift = fn (cls: Class, previously: ?*anyopaque) callconv(.C) Class;
        pub const struct_objc_method_list = opaque {};
        pub const class_lookupMethod = fn (cls: Class, sel: SEL) callconv(.C) IMP;
        pub const class_respondsToMethod = fn (cls: Class, sel: SEL) callconv(.C) BOOL;
        pub const _objc_flush_caches = fn (cls: Class) callconv(.C) void;
        pub const object_copyFromZone = fn (anObject: id, nBytes: usize, z: ?*anyopaque) callconv(.C) id;
        pub const class_createInstanceFromZone = fn (Class, idxIvars: usize, z: ?*anyopaque) callconv(.C) id;
        pub inline fn __P(protos: anytype) @TypeOf(protos) {
            return protos;
        }
        pub const @"bool" = bool;
        pub const @"true" = @as(c_int, 1);
        pub const @"false" = @as(c_int, 0);
        pub const __bool_true_false_are_defined = @as(c_int, 1);
        pub const OBJC_BOOL_IS_BOOL = @as(c_int, 1);
        pub const OBJC_BOOL_DEFINED = "";
        pub const Nil = @as(usize, 0);
        pub const nil = @as(usize, 0);
        pub const __autoreleasing = "";
        pub const ARITH_SHIFT = @as(c_int, 32);
        pub inline fn ISSELECTOR(sel: anytype) @TypeOf(sel_isMapped(sel)) {
            return sel_isMapped(sel);
        }
        pub inline fn SELNAME(sel: anytype) @TypeOf(sel_getName(sel)) {
            return sel_getName(sel);
        }
        pub inline fn SELUID(str: anytype) @TypeOf(sel_getUid(str)) {
            return sel_getUid(str);
        }
        pub inline fn NAMEOF(obj: anytype) @TypeOf(object_getClassName(obj)) {
            return object_getClassName(obj);
        }
        pub inline fn IV(obj: anytype) @TypeOf(object_getIndexedIvars(obj)) {
            return object_getIndexedIvars(obj);
        }
        pub const NULL = @import("std").zig.c_translation.cast(?*anyopaque, @as(c_int, 0));
        pub const objc_class = struct_objc_class;
        pub const objc_object = struct_objc_object;
        pub const objc_selector = struct_objc_selector;
        pub const objc_method = struct_objc_method;
        pub const objc_ivar = struct_objc_ivar;
        pub const objc_category = struct_objc_category;
        pub const objc_property = struct_objc_property;
        pub const objc_method_description = struct_objc_method_description;
        pub const mach_header = struct_mach_header;
        pub const objc_method_list = struct_objc_method_list;
    };
};
