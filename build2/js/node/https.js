(function (){"use strict";// build2/tmp/node/https.ts
var request = function(input, options, cb) {
  if (input && typeof input === "object" && !(input instanceof URL)) {
    input.protocol ??= "https:";
  } else if (typeof options === "object") {
    options.protocol ??= "https:";
  }
  return http.request(input, options, cb);
};
var get = function(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
};
var $;
var http = @getInternalField(@internalModuleRegistry, 23) || @createInternalModuleById(23);
$ = {
  ...http,
  get,
  request
};
return $})
