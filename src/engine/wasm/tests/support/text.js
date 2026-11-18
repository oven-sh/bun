function load(text, imports) {
  return new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(assemble(text))), { host: imports }).exports;
}

