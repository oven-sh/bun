interface Inner0 { extra: number; quiet?: () => unknown }
interface Box0 { extra: number; name: string; inner: Inner0; failed?: { extra: number; message: string; name: string } }
export const box0: Box0 = { extra: 0, name: 'b0', inner: { extra: 0 } };
export function make0(extra: number): Box0 { return { extra, name: 'm', inner: { extra } }; }
