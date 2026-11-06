import { report } from "./reader.js";
const local = 1;
report("early", "import-meta");
export default import.meta;
report("late", "import-meta");
