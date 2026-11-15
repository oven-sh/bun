// The reference is `bun <file>`: d.mjs is overtaken while a.mjs waits, so its functions run ahead of its body. A bundle runs the bodies in another order: the executable that `bun build --compile` makes without --aot says 12 where this says 22.
import "./a.mjs"; import "./d.mjs"; import "./e.mjs";
