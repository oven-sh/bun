(function (){"use strict";// build3/tmp/node/dgram.ts
var createSocket = function() {
  throwNotImplemented("node:dgram createSocket", 1630);
};
var Socket = function() {
  throwNotImplemented("node:dgram Socket", 1630);
};
var _createSocketHandle = function() {
  throwNotImplemented("node:dgram _createSocketHandle", 1630);
};
var $;
var { hideFromStack, throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
$ = {
  createSocket,
  Socket,
  _createSocketHandle
};
hideFromStack(createSocket, Socket, _createSocketHandle);
return $})
