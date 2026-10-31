console.log("--- Début test_compat_more.js ---");

// 1. Test fs/promises
try {
  console.log("1. Chargement de node:fs/promises...");
  const fsPromises = require("node:fs/promises");
  console.log("-> Réussi ! Méthodes dispo :", Object.keys(fsPromises).join(", "));
} catch (e) {
  console.log("❌ ÉCHEC ÉTAPE 1 (fs/promises) :", e.toString());
}

// 2. Test string_decoder
try {
  console.log("2. Chargement de node:string_decoder...");
  const { StringDecoder } = require("node:string_decoder");
  const decoder = new StringDecoder("utf8");
  const decoded = decoder.write(Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
  console.log("-> Réussi ! Decoded:", decoded);
} catch (e) {
  console.log("❌ ÉCHEC ÉTAPE 2 (string_decoder) :", e.toString());
}

// 3. Test readline
try {
  console.log("3. Chargement de node:readline...");
  const readline = require("node:readline");
  console.log("-> Réussi ! Méthodes readline :", Object.keys(readline).join(", "));
} catch (e) {
  console.log("❌ ÉCHEC ÉTAPE 3 (readline) :", e.toString());
}

// 4. Test events (once et EventEmitter complet)
try {
  console.log("4. Test de node:events complet...");
  const EventEmitter = require("node:events");
  const emitter = new EventEmitter();
  let count = 0;
  if (typeof emitter.once === 'function') {
    emitter.once("test-event", () => {
      count++;
    });
    emitter.emit("test-event");
    emitter.emit("test-event");
    console.log("-> Réussi ! Count (doit être 1) :", count);
  } else {
    console.log("❌ emitter.once n'est pas une fonction !");
  }
} catch (e) {
  console.log("❌ ÉCHEC ÉTAPE 4 (events) :", e.toString());
}

console.log("--- Fin test_compat_more.js ---");
"SUCCESS"
