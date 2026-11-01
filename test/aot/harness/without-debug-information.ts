import { withoutDebugInformation as findFlags } from "./commands";

/** The flags with which a build makes its executable of this Bun without its debug information. None where it has none. */
export const withoutDebugInformation: string[] = findFlags();

/** The path of that copy. */
export const copyWithoutDebugInformation: string | undefined = withoutDebugInformation[1];
