const inspector = require('node:inspector');
inspector.open(0);
console.error('URL=' + inspector.url());
inspector.close();
