// rr-shapes-07.d.ts: piece 7's additions (original.js 3686..4229).
declare namespace RR {
  /**
   * GetDerivedStateFromProps as applyDerivedStateFromProps (3738) takes it: THE RESULT NAMED (a partial state | nothing) instead of `any`, so that the
   * one variable that holds the function, then its result, then the merged state stays a union and narrows by assignment. A GetDerivedStateFromProps goes in without a cast.
   */
  type DeriveStateFromProps = (nextProps: any, prevState: any) => ClassState | null | undefined;
  /**
   * The props updateForwardRef (4035) is given: Props with the one member it asks for ("ref" in nextProps) NAMED. given. The name is there for the checker:
   * Props has NO declared member, so it is assignable to every opaque type of ours (HostObject, ClassState, LegacyContext, piece 8's CarriedObject ..: all their
   * members are optional, and "nothing in common" is only said of a source that has members), and narrowing by assignment keeps them beside it:
   * `var p: Props | Carried = props` is `Props | CarriedObject`, and the next read needs a cast. With one declared member it narrows to the props alone.
   */
  interface PropsWithRef extends Props { ref?: unknown }
  /** MemoType.compare without its null; shallowEqual is one */
  type MemoCompare = (prevProps: any, nextProps: any) => boolean;
}
