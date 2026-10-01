// Research probe: a check module for --check that replays the oracle, so that the sweep shows what a checker that passes looks like.
import { replayCheck, runOracleOf } from "./index";
import type { Corpus } from "./index";
export default ({ corpus }: { corpus: Corpus }) => replayCheck(i => runOracleOf(corpus, i.suite, i.name));
