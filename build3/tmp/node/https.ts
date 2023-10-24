var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/https.ts


// Hardcoded module "node:https"
const http = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 23/*node:http*/) || __intrinsic__createInternalModuleById(23/*node:http*/));

function request(input, options, cb) {
  if (input && typeof input === "object" && !(input instanceof URL)) {
    input.protocol ??= "https:";
  } else if (typeof options === "object") {
    options.protocol ??= "https:";
  }

  return http.request(input, options, cb);
}

function get(input, options, cb) {
  const req = request(input, options, cb);
  req.end();
  return req;
}

$ = {
  ...http,
  get,
  request,
};
$$EXPORT$$($).$$EXPORT_END$$;
