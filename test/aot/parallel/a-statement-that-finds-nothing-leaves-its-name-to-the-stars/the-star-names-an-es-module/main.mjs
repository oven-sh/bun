import { measure, paint, repaint } from "./index.mjs";
import * as all from "./index.mjs";
console.log(measure, paint, Object.keys(all).join());
repaint();
console.log(paint, all.paint);
