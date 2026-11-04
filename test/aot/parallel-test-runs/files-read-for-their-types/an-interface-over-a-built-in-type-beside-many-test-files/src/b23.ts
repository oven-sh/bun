interface Inner23 { extra: number; quiet?: () => unknown }
interface Box23 { extra: number; name: string; inner: Inner23; failed?: { extra: number; message: string; name: string } }
export const box23: Box23 = { extra: 23, name: 'b23', inner: { extra: 23 } };
export function make23(extra: number): Box23 { return { extra, name: 'm', inner: { extra } }; }
