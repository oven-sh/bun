interface Inner6 { extra: number; quiet?: () => unknown }
interface Box6 { extra: number; name: string; inner: Inner6; failed?: { extra: number; message: string; name: string } }
export const box6: Box6 = { extra: 6, name: 'b6', inner: { extra: 6 } };
export function make6(extra: number): Box6 { return { extra, name: 'm', inner: { extra } }; }
