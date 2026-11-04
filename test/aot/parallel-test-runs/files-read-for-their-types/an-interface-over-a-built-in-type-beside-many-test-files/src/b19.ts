interface Inner19 { extra: number; quiet?: () => unknown }
interface Box19 { extra: number; name: string; inner: Inner19; failed?: { extra: number; message: string; name: string } }
export const box19: Box19 = { extra: 19, name: 'b19', inner: { extra: 19 } };
export function make19(extra: number): Box19 { return { extra, name: 'm', inner: { extra } }; }
