const { parent } = module;
console.log(parent ? "required by " + parent.filename.split(/[\\/]/).pop() : "started");
