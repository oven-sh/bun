const turn = module.turn;
if (turn === 0) throw new Error("made up");
Object.defineProperty(module, "exports", { configurable: true, get: () => "turn " + turn });
