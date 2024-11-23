import toml from "./bunfig.toml";
import text from "./bunfig.txt";
import { expectAny, expectType } from "./utilities.test";

expectAny(toml);
expectType<string>(text);
