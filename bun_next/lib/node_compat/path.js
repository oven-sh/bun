module.exports = {
  join: (...args) => {
    // Implémentation simplifiée
    return args.filter(a => a).join('/').replace(/\/+/g, '/');
  },
  resolve: (...args) => {
    return args.filter(a => a).join('/').replace(/\/+/g, '/');
  },
  basename: (path) => {
    return path.split(/[\\/]/).pop();
  },
  dirname: (path) => {
    const parts = path.split(/[\\/]/);
    parts.pop();
    return parts.join('/') || '.';
  },
  extname: (path) => {
    const base = path.split(/[\\/]/).pop();
    const idx = base.lastIndexOf('.');
    return idx === -1 ? '' : base.substring(idx);
  },
  sep: '/',
  delimiter: ';'
};
