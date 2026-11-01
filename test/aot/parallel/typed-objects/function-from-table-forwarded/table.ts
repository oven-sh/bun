export interface Ctx { id: number; parent?: Ctx }
export interface P0 { ctx: Ctx; v0: number; inner0: { deep: { value0: number; again?: P0 } } }
export interface P1 { ctx: Ctx; v1: number; inner1: { deep: { value1: number; again?: P1 } } }
export interface P2 { ctx: Ctx; v2: number; inner2: { deep: { value2: number; again?: P2 } } }
export interface P3 { ctx: Ctx; v3: number; inner3: { deep: { value3: number; again?: P3 } } }
export interface P4 { ctx: Ctx; v4: number; inner4: { deep: { value4: number; again?: P4 } } }
export interface P5 { ctx: Ctx; v5: number; inner5: { deep: { value5: number; again?: P5 } } }
export interface P6 { ctx: Ctx; v6: number; inner6: { deep: { value6: number; again?: P6 } } }
export interface P7 { ctx: Ctx; v7: number; inner7: { deep: { value7: number; again?: P7 } } }
export interface P8 { ctx: Ctx; v8: number; inner8: { deep: { value8: number; again?: P8 } } }
export interface P9 { ctx: Ctx; v9: number; inner9: { deep: { value9: number; again?: P9 } } }
export interface P10 { ctx: Ctx; v10: number; inner10: { deep: { value10: number; again?: P10 } } }
export interface P11 { ctx: Ctx; v11: number; inner11: { deep: { value11: number; again?: P11 } } }
export interface P12 { ctx: Ctx; v12: number; inner12: { deep: { value12: number; again?: P12 } } }
export interface P13 { ctx: Ctx; v13: number; inner13: { deep: { value13: number; again?: P13 } } }
export interface P14 { ctx: Ctx; v14: number; inner14: { deep: { value14: number; again?: P14 } } }
export interface P15 { ctx: Ctx; v15: number; inner15: { deep: { value15: number; again?: P15 } } }
export interface P16 { ctx: Ctx; v16: number; inner16: { deep: { value16: number; again?: P16 } } }
export interface P17 { ctx: Ctx; v17: number; inner17: { deep: { value17: number; again?: P17 } } }
export interface P18 { ctx: Ctx; v18: number; inner18: { deep: { value18: number; again?: P18 } } }
export interface P19 { ctx: Ctx; v19: number; inner19: { deep: { value19: number; again?: P19 } } }
export interface P20 { ctx: Ctx; v20: number; inner20: { deep: { value20: number; again?: P20 } } }
export interface P21 { ctx: Ctx; v21: number; inner21: { deep: { value21: number; again?: P21 } } }
export interface P22 { ctx: Ctx; v22: number; inner22: { deep: { value22: number; again?: P22 } } }
export interface P23 { ctx: Ctx; v23: number; inner23: { deep: { value23: number; again?: P23 } } }
export interface Handlers {
  h0(p: P0): number;
  h1(p: P1): number;
  h2(p: P2): number;
  h3(p: P3): number;
  h4(p: P4): number;
  h5(p: P5): number;
  h6(p: P6): number;
  h7(p: P7): number;
  h8(p: P8): number;
  h9(p: P9): number;
  h10(p: P10): number;
  h11(p: P11): number;
  h12(p: P12): number;
  h13(p: P13): number;
  h14(p: P14): number;
  h15(p: P15): number;
  h16(p: P16): number;
  h17(p: P17): number;
  h18(p: P18): number;
  h19(p: P19): number;
  h20(p: P20): number;
  h21(p: P21): number;
  h22(p: P22): number;
  h23(p: P23): number;
}
export const table = {
  h0(p: P0): number { return p.v0 + p.ctx.id; },
  h1(p: P1): number { return p.v1 + p.ctx.id; },
  h2(p: P2): number { return p.v2 + p.ctx.id; },
  h3(p: P3): number { return p.v3 + p.ctx.id; },
  h4(p: P4): number { return p.v4 + p.ctx.id; },
  h5(p: P5): number { return p.v5 + p.ctx.id; },
  h6(p: P6): number { return p.v6 + p.ctx.id; },
  h7(p: P7): number { return p.v7 + p.ctx.id; },
  h8(p: P8): number { return p.v8 + p.ctx.id; },
  h9(p: P9): number { return p.v9 + p.ctx.id; },
  h10(p: P10): number { return p.v10 + p.ctx.id; },
  h11(p: P11): number { return p.v11 + p.ctx.id; },
  h12(p: P12): number { return p.v12 + p.ctx.id; },
  h13(p: P13): number { return p.v13 + p.ctx.id; },
  h14(p: P14): number { return p.v14 + p.ctx.id; },
  h15(p: P15): number { return p.v15 + p.ctx.id; },
  h16(p: P16): number { return p.v16 + p.ctx.id; },
  h17(p: P17): number { return p.v17 + p.ctx.id; },
  h18(p: P18): number { return p.v18 + p.ctx.id; },
  h19(p: P19): number { return p.v19 + p.ctx.id; },
  h20(p: P20): number { return p.v20 + p.ctx.id; },
  h21(p: P21): number { return p.v21 + p.ctx.id; },
  h22(p: P22): number { return p.v22 + p.ctx.id; },
  h23(p: P23): number { return p.v23 + p.ctx.id; },
} satisfies Handlers;
