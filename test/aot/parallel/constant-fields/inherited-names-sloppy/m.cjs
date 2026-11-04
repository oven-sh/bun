const E = {};
E.toString = 0;
E.valueOf = 1;
E.constructor = 2;
exports.read = () => [typeof E.toString, typeof E.valueOf, typeof E.constructor].join();
