const E = {};
E.toString = 0;
E.valueOf = 1;
E.constructor = 2;
export const read = () => [E.toString, E.valueOf, E.constructor].join();
