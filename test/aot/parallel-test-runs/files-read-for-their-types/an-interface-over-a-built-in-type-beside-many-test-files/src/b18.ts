interface Inner18 { extra: number; quiet?: () => unknown }
interface Box18 { extra: number; name: string; inner: Inner18; failed?: { extra: number; message: string; name: string } }
export const box18: Box18 = { extra: 18, name: 'b18', inner: { extra: 18 } };
export function make18(extra: number): Box18 { return { extra, name: 'm', inner: { extra } }; }
