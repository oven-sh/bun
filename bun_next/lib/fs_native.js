// Bibliothèque standard native de Bun-Elixir
// Fournit des APIs compatibles Node.js ultra-rapides reliées au Rust

const fs_binding = internalBinding('fs');

exports.readFileSync = function(path, options) {
    const encoding = typeof options === 'string' ? options : (options && options.encoding);
    const data = fs_binding.readFileUtf8(path);
    
    if (encoding === 'utf8') {
        return data;
    }
    
    // Pour l'instant on ne supporte que utf8
    return data;
};

exports.constants = internalBinding('constants').fs;
