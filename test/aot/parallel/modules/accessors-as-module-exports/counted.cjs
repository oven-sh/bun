let turns = 0;
Object.defineProperty(module, "exports", { get: () => ({ turn: ++turns }) });
