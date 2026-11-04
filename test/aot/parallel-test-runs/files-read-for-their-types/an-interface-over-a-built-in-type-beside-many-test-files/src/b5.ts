interface Inner5 { extra: number; quiet?: () => unknown }
interface Box5 { extra: number; name: string; inner: Inner5; failed?: { extra: number; message: string; name: string } }
export const box5: Box5 = { extra: 5, name: 'b5', inner: { extra: 5 } };
export function make5(extra: number): Box5 { return { extra, name: 'm', inner: { extra } }; }
