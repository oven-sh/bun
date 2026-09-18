module.exports = {
  describe: (name, options, fn) => {
    if (typeof options === 'function') fn = options;
    console.log(`Describe: ${name}`);
    fn();
  },
  it: (name, fn) => {
    console.log(`  It: ${name}`);
    return fn(); // On exécute directement pour l'instant
  }
};
