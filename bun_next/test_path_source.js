try {
    const path = require('./node_source/node-26.0.0/lib/path.js');
    console.log("✅ Path chargé depuis les sources de Node.js v26 !");
    console.log("Extname de test.js :", path.extname('test.js'));
} catch (e) {
    console.log("Erreur :", e);
}
