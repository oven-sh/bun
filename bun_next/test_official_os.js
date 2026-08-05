// Test de require('node:os') officiel
console.log('==> Tentative de chargement du module node:os officiel...');

const os = require('node:os');

console.log('--- Propriétés du module OS officiel ---');
console.log('Hostname:', os.hostname());
console.log('Platform:', os.platform());
console.log('Release:', os.release ? os.release() : 'N/A');
console.log('Arch:', os.arch ? os.arch() : 'N/A');

if (os.hostname()) {
    console.log('✅ Succès : require("node:os") a fonctionné !');
}
