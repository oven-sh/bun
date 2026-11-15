export const hidden: number = JSON.parse("1");
export function Page(): unknown { return <page />; }
export function InArrow(): unknown { return (() => <arrow />)(); }
export const Stored = function (): unknown { return <stored />; };
export function Plain(): unknown { return "plain"; }
