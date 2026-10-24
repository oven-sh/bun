// rr-shapes-16.d.ts: piece 16's additions (original.js 8985..9478: commitRootWhenReady .. replaySuspendedUnitOfWork).

// f.bind(thisArg, ..MORE arguments than f has parameters) (9026: commitRoot has 9, bind is given 14: the five that only the profiling build reads).
// The language drops the surplus; the library's strict `bind` refuses it. It takes ALL of f's parameters and AT LEAST ONE more, so that every other bind
// (fewer arguments, or exactly as many) still goes by the library's own signatures.




declare namespace RR {
  /** What waitForCommitToBeReady answers where the commit must wait: it is given the commit, and answers the function that calls the wait off. given (the host's) */
  type ScheduleCommit = (initiateCommit: () => unknown) => () => void;
  /** commitRootWhenReady's 12th argument: "Throttled" (8955) | null (8975). Only the profiling build reads it: here the parameter is stored to before it is read */
  type SuspendedCommitReason = string | null;
}
