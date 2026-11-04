import { tell } from "./tell.ts";
const holder = { none: null };
await null;
try { console.log(holder.none.behindAwait); } catch (error) { tell("behind an await", error); }
try { console.log(await 1, "a" in holder.none); } catch (error) { tell("key test beside an await", error); }
try { for await (const each of holder.none) console.log(each); } catch (error) { tell("loop that awaits", error); }
