exports.m = [module.id === __filename, module.filename === __filename, module.loaded, module.parent === require.main].join();
