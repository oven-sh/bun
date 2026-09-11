'use strict';

const BuiltinModule = {
  exists(id) {
    // Si c'est un module interne ou officiel, on peut renvoyer true pour certains si besoin.
    // Mais false suffit généralement pour inspect.js
    return false;
  },
  map: new Map()
};

module.exports = {
  internalBinding: globalThis.internalBinding,
  BuiltinModule,
  require: globalThis.require || ((id) => {
    return require(id);
  })
};
