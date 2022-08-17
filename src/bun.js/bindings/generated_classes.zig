
const JSC = @import("javascript_core");
const Classes = @import("./generated_classes_list.zig").Classes;
const Environment = @import("../../env.zig");
const std = @import("std");

const StaticGetterType = fn(*JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
const StaticSetterType = fn(*JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
const StaticCallbackType = fn(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;



pub const JSRequest = struct {
    const Request = Classes.Request;
    const GetterType = fn(*Request, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn(*Request, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn(*Request, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Request {
        JSC.markBinding();
        return Request__fromJS(value);
    }

    /// Create a new instance of Request
    pub fn toJS(this: *Request, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = Request__create(globalObject, this);
            std.debug.assert(value__.as(Request).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Request__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Request.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Request) bool {
      JSC.markBinding();
      return Request__dangerouslySetPtr(value, ptr);
    }

    extern fn Request__fromJS(JSC.JSValue) ?*Request;

    extern fn Request__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Request) JSC.JSValue;

    extern fn Request__dangerouslySetPtr(JSC.JSValue, ?*Request) bool;

    comptime {
        
        if (@TypeOf(Request.constructor) != (fn(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Request)) {
           @compileLog("Request.constructor is not a constructor");
        }
      
        if (@TypeOf(Request.finalize) != (fn(*Request) callconv(.C) void)) {
           @compileLog("Request.finalize is not a finalizer");
        }
      
          if (@TypeOf(Request.getArrayBuffer) != CallbackType) 
            @compileLog(
              "Expected Request.getArrayBuffer to be a callback"
            );
          if (@TypeOf(Request.getBlob) != CallbackType) 
            @compileLog(
              "Expected Request.getBlob to be a callback"
            );
          if (@TypeOf(Request.getBodyUsed) != GetterType) 
            @compileLog(
              "Expected Request.getBodyUsed to be a getter"
            );

          if (@TypeOf(Request.getCache) != GetterType) 
            @compileLog(
              "Expected Request.getCache to be a getter"
            );

          if (@TypeOf(Request.doClone) != CallbackType) 
            @compileLog(
              "Expected Request.doClone to be a callback"
            );
          if (@TypeOf(Request.getCredentials) != GetterType) 
            @compileLog(
              "Expected Request.getCredentials to be a getter"
            );

          if (@TypeOf(Request.getDestination) != GetterType) 
            @compileLog(
              "Expected Request.getDestination to be a getter"
            );

          if (@TypeOf(Request.getHeaders) != GetterType) 
            @compileLog(
              "Expected Request.getHeaders to be a getter"
            );

          if (@TypeOf(Request.getIntegrity) != GetterType) 
            @compileLog(
              "Expected Request.getIntegrity to be a getter"
            );

          if (@TypeOf(Request.getJSON) != CallbackType) 
            @compileLog(
              "Expected Request.getJSON to be a callback"
            );
          if (@TypeOf(Request.getMethod) != GetterType) 
            @compileLog(
              "Expected Request.getMethod to be a getter"
            );

          if (@TypeOf(Request.getMode) != GetterType) 
            @compileLog(
              "Expected Request.getMode to be a getter"
            );

          if (@TypeOf(Request.getRedirect) != GetterType) 
            @compileLog(
              "Expected Request.getRedirect to be a getter"
            );

          if (@TypeOf(Request.getReferrer) != GetterType) 
            @compileLog(
              "Expected Request.getReferrer to be a getter"
            );

          if (@TypeOf(Request.getReferrerPolicy) != GetterType) 
            @compileLog(
              "Expected Request.getReferrerPolicy to be a getter"
            );

          if (@TypeOf(Request.getText) != CallbackType) 
            @compileLog(
              "Expected Request.getText to be a callback"
            );
          if (@TypeOf(Request.getUrl) != GetterType) 
            @compileLog(
              "Expected Request.getUrl to be a getter"
            );

        if (!JSC.is_bindgen) {
@export(Request.constructor, .{.name = "RequestClass__construct"});
          @export(Request.doClone, .{.name = "RequestPrototype__doClone"});
          @export(Request.finalize, .{.name = "RequestClass__finalize"});
          @export(Request.getArrayBuffer, .{.name = "RequestPrototype__getArrayBuffer"});
          @export(Request.getBlob, .{.name = "RequestPrototype__getBlob"});
          @export(Request.getBodyUsed, .{.name = "RequestPrototype__getBodyUsed"});
          @export(Request.getCache, .{.name = "RequestPrototype__getCache"});
          @export(Request.getCredentials, .{.name = "RequestPrototype__getCredentials"});
          @export(Request.getDestination, .{.name = "RequestPrototype__getDestination"});
          @export(Request.getHeaders, .{.name = "RequestPrototype__getHeaders"});
          @export(Request.getIntegrity, .{.name = "RequestPrototype__getIntegrity"});
          @export(Request.getJSON, .{.name = "RequestPrototype__getJSON"});
          @export(Request.getMethod, .{.name = "RequestPrototype__getMethod"});
          @export(Request.getMode, .{.name = "RequestPrototype__getMode"});
          @export(Request.getRedirect, .{.name = "RequestPrototype__getRedirect"});
          @export(Request.getReferrer, .{.name = "RequestPrototype__getReferrer"});
          @export(Request.getReferrerPolicy, .{.name = "RequestPrototype__getReferrerPolicy"});
          @export(Request.getText, .{.name = "RequestPrototype__getText"});
          @export(Request.getUrl, .{.name = "RequestPrototype__getUrl"});
        }
    }
};
pub const JSResponse = struct {
    const Response = Classes.Response;
    const GetterType = fn(*Response, *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;
    const SetterType = fn(*Response, *JSC.JSGlobalObject, JSC.JSValue) callconv(.C) bool;
    const CallbackType = fn(*Response, *JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) JSC.JSValue;

    /// Return the pointer to the wrapped object.
    /// If the object does not match the type, return null.
    pub fn fromJS(value: JSC.JSValue) ?*Response {
        JSC.markBinding();
        return Response__fromJS(value);
    }

    /// Create a new instance of Response
    pub fn toJS(this: *Response, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        JSC.markBinding();
        if (comptime Environment.allow_assert) {
            const value__ = Response__create(globalObject, this);
            std.debug.assert(value__.as(Response).? == this); // If this fails, likely a C ABI issue.
            return value__;
        } else {
            return Response__create(globalObject, this);
        }
    }

    /// Modify the internal ptr to point to a new instance of Response.
    pub fn dangerouslySetPtr(value: JSC.JSValue, ptr: ?*Response) bool {
      JSC.markBinding();
      return Response__dangerouslySetPtr(value, ptr);
    }

    extern fn Response__fromJS(JSC.JSValue) ?*Response;

    extern fn Response__create(globalObject: *JSC.JSGlobalObject, ptr: ?*Response) JSC.JSValue;

    extern fn Response__dangerouslySetPtr(JSC.JSValue, ?*Response) bool;

    comptime {
        
        if (@TypeOf(Response.constructor) != (fn(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(.C) ?*Response)) {
           @compileLog("Response.constructor is not a constructor");
        }
      
        if (@TypeOf(Response.finalize) != (fn(*Response) callconv(.C) void)) {
           @compileLog("Response.finalize is not a finalizer");
        }
      
          if (@TypeOf(Response.getArrayBuffer) != CallbackType) 
            @compileLog(
              "Expected Response.getArrayBuffer to be a callback"
            );
          if (@TypeOf(Response.getBlob) != CallbackType) 
            @compileLog(
              "Expected Response.getBlob to be a callback"
            );
          if (@TypeOf(Response.getBodyUsed) != GetterType) 
            @compileLog(
              "Expected Response.getBodyUsed to be a getter"
            );

          if (@TypeOf(Response.doClone) != CallbackType) 
            @compileLog(
              "Expected Response.doClone to be a callback"
            );
          if (@TypeOf(Response.getHeaders) != GetterType) 
            @compileLog(
              "Expected Response.getHeaders to be a getter"
            );

          if (@TypeOf(Response.getJSON) != CallbackType) 
            @compileLog(
              "Expected Response.getJSON to be a callback"
            );
          if (@TypeOf(Response.getOK) != GetterType) 
            @compileLog(
              "Expected Response.getOK to be a getter"
            );

          if (@TypeOf(Response.getStatus) != GetterType) 
            @compileLog(
              "Expected Response.getStatus to be a getter"
            );

          if (@TypeOf(Response.getStatusText) != GetterType) 
            @compileLog(
              "Expected Response.getStatusText to be a getter"
            );

          if (@TypeOf(Response.getText) != CallbackType) 
            @compileLog(
              "Expected Response.getText to be a callback"
            );
          if (@TypeOf(Response.getResponseType) != GetterType) 
            @compileLog(
              "Expected Response.getResponseType to be a getter"
            );

          if (@TypeOf(Response.getURL) != GetterType) 
            @compileLog(
              "Expected Response.getURL to be a getter"
            );

          if (@TypeOf(Response.constructError) != StaticCallbackType) 
            @compileLog(
              "Expected Response.constructError to be a static callback"
            );
          if (@TypeOf(Response.constructJSON) != StaticCallbackType) 
            @compileLog(
              "Expected Response.constructJSON to be a static callback"
            );
          if (@TypeOf(Response.constructRedirect) != StaticCallbackType) 
            @compileLog(
              "Expected Response.constructRedirect to be a static callback"
            );
        if (!JSC.is_bindgen) {
@export(Response.constructError, .{.name = "ResponseClass__constructError"});
          @export(Response.constructJSON, .{.name = "ResponseClass__constructJSON"});
          @export(Response.constructor, .{.name = "ResponseClass__construct"});
          @export(Response.constructRedirect, .{.name = "ResponseClass__constructRedirect"});
          @export(Response.doClone, .{.name = "ResponsePrototype__doClone"});
          @export(Response.finalize, .{.name = "ResponseClass__finalize"});
          @export(Response.getArrayBuffer, .{.name = "ResponsePrototype__getArrayBuffer"});
          @export(Response.getBlob, .{.name = "ResponsePrototype__getBlob"});
          @export(Response.getBodyUsed, .{.name = "ResponsePrototype__getBodyUsed"});
          @export(Response.getHeaders, .{.name = "ResponsePrototype__getHeaders"});
          @export(Response.getJSON, .{.name = "ResponsePrototype__getJSON"});
          @export(Response.getOK, .{.name = "ResponsePrototype__getOK"});
          @export(Response.getResponseType, .{.name = "ResponsePrototype__getResponseType"});
          @export(Response.getStatus, .{.name = "ResponsePrototype__getStatus"});
          @export(Response.getStatusText, .{.name = "ResponsePrototype__getStatusText"});
          @export(Response.getText, .{.name = "ResponsePrototype__getText"});
          @export(Response.getURL, .{.name = "ResponsePrototype__getURL"});
        }
    }
};