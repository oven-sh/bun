// This file explicitly redefines global types used in order to enforce the correct types,
// regardless of the arbitrary order in which TSC/TSServer decide to load the type libraries in.
// Annoyingly, even this file can sometimes break, so if your types are inverted, try restarting TSServer.

declare var process: NodeJS.Process;
