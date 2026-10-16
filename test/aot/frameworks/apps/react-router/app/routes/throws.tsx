export function loader(): never { throw new RangeError("thrown in a loader"); }

export default function Never() { return <p>never shown</p>; }
