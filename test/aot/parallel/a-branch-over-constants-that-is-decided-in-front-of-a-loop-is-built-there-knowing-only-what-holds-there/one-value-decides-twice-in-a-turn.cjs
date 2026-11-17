'use strict';
process.env.TGM_SET = 'debug'; delete process.env.TGM_UNSET;
const D = JSON.parse('{"empty":"","full":"prod"}');
function or_u() { return process.env.TGM_UNSET || 'info'; }
function pick_u() { return process.env.TGM_UNSET ? 30 : 50; }
function or_s() { return process.env.TGM_SET || 'info'; }
function pick_s() { return process.env.TGM_SET ? 30 : 50; }
function or_e() { return D.empty || 'info'; }
function pick_e() { return D.empty ? 30 : 50; }
function or_f() { return D.full || 'info'; }
function pick_f() { return D.full ? 30 : 50; }
function p_ce_de(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((D.empty || 'dev') === 'dev' ? 100 : 200) + (D.empty || 'info').length; return s; }
function p_ce_ce(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((D.empty || 'dev') === 'dev' ? 100 : 200) + ((D.empty || 'dev') === 'dev' ? 100 : 200); return s; }
function p_cf_cf(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((D.full || 'dev') === 'dev' ? 100 : 200) + ((D.full || 'dev') === 'dev' ? 100 : 200); return s; }
function p_cf_df(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((D.full || 'dev') === 'dev' ? 100 : 200) + (D.full || 'info').length; return s; }
function p_cs_cs(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((process.env.TGM_SET || 'dev') === 'dev' ? 100 : 200) + ((process.env.TGM_SET || 'dev') === 'dev' ? 100 : 200); return s; }
function p_cs_ds(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((process.env.TGM_SET || 'dev') === 'dev' ? 100 : 200) + (process.env.TGM_SET || 'info').length; return s; }
function p_cs_is(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((process.env.TGM_SET || 'dev') === 'dev' ? 100 : 200) + or_s().length; return s; }
function p_cu_cu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200) + ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200); return s; }
function p_cu_du(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200) + (process.env.TGM_UNSET || 'info').length; return s; }
function p_cu_iu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200) + or_u().length; return s; }
function p_de_ce(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (D.empty || 'info').length + ((D.empty || 'dev') === 'dev' ? 100 : 200); return s; }
function p_df_cf(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (D.full || 'info').length + ((D.full || 'dev') === 'dev' ? 100 : 200); return s; }
function p_ds_cs(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (process.env.TGM_SET || 'info').length + ((process.env.TGM_SET || 'dev') === 'dev' ? 100 : 200); return s; }
function p_ds_is(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (process.env.TGM_SET || 'info').length + or_s().length; return s; }
function p_du_cu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (process.env.TGM_UNSET || 'info').length + ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200); return s; }
function p_du_iu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (process.env.TGM_UNSET || 'info').length + or_u().length; return s; }
function p_is_cs(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += or_s().length + ((process.env.TGM_SET || 'dev') === 'dev' ? 100 : 200); return s; }
function p_is_ds(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += or_s().length + (process.env.TGM_SET || 'info').length; return s; }
function p_is_is(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += or_s().length + or_s().length; return s; }
function p_iu_du(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += or_u().length + (process.env.TGM_UNSET || 'info').length; return s; }
function p_iu_cu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += or_u().length + ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200); return s; }
function p_iu_iu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += or_u().length + or_u().length; return s; }
function q1_097_de_du_cu(t) { let s = t & 1; for (let i = 0; i < 12; i++) s += (D.empty || 'info').length; for (let i = 12; i > 0; i--) s += (process.env.TGM_UNSET || 'info').length + ((process.env.TGM_UNSET || 'dev') === 'dev' ? 100 : 200); return s; }
console.log([p_ce_de, p_ce_ce, p_cf_cf, p_cf_df, p_cs_cs, p_cs_ds, p_cs_is, p_cu_cu, p_cu_du, p_cu_iu, p_de_ce, p_df_cf, p_ds_cs, p_ds_is, p_du_cu, p_du_iu, p_is_cs, p_is_ds, p_is_is, p_iu_du, p_iu_cu, p_iu_iu, q1_097_de_du_cu].map(f => f(0) + f(1)).join());
