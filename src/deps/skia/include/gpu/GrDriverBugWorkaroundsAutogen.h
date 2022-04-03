// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// This file is auto-generated from build_workaround_header.py
// DO NOT EDIT!

#define GPU_DRIVER_BUG_WORKAROUNDS(GPU_OP)              \
  GPU_OP(ADD_AND_TRUE_TO_LOOP_CONDITION,                \
         add_and_true_to_loop_condition)                \
  GPU_OP(DISABLE_BLEND_EQUATION_ADVANCED,               \
         disable_blend_equation_advanced)               \
  GPU_OP(DISABLE_DISCARD_FRAMEBUFFER,                   \
         disable_discard_framebuffer)                   \
  GPU_OP(DISABLE_DUAL_SOURCE_BLENDING_SUPPORT,          \
         disable_dual_source_blending_support)          \
  GPU_OP(DISABLE_TEXTURE_STORAGE,                       \
         disable_texture_storage)                       \
  GPU_OP(DISALLOW_LARGE_INSTANCED_DRAW,                 \
         disallow_large_instanced_draw)                 \
  GPU_OP(EMULATE_ABS_INT_FUNCTION,                      \
         emulate_abs_int_function)                      \
  GPU_OP(FLUSH_ON_FRAMEBUFFER_CHANGE,                   \
         flush_on_framebuffer_change)                   \
  GPU_OP(FORCE_UPDATE_SCISSOR_STATE_WHEN_BINDING_FBO0,  \
         force_update_scissor_state_when_binding_fbo0)  \
  GPU_OP(GL_CLEAR_BROKEN,                               \
         gl_clear_broken)                               \
  GPU_OP(MAX_FRAGMENT_UNIFORM_VECTORS_32,               \
         max_fragment_uniform_vectors_32)               \
  GPU_OP(MAX_MSAA_SAMPLE_COUNT_4,                       \
         max_msaa_sample_count_4)                       \
  GPU_OP(MAX_TEXTURE_SIZE_LIMIT_4096,                   \
         max_texture_size_limit_4096)                   \
  GPU_OP(PACK_PARAMETERS_WORKAROUND_WITH_PACK_BUFFER,   \
         pack_parameters_workaround_with_pack_buffer)   \
  GPU_OP(REMOVE_POW_WITH_CONSTANT_EXPONENT,             \
         remove_pow_with_constant_exponent)             \
  GPU_OP(REWRITE_DO_WHILE_LOOPS,                        \
         rewrite_do_while_loops)                        \
  GPU_OP(UNBIND_ATTACHMENTS_ON_BOUND_RENDER_FBO_DELETE, \
         unbind_attachments_on_bound_render_fbo_delete) \
  GPU_OP(UNFOLD_SHORT_CIRCUIT_AS_TERNARY_OPERATION,     \
         unfold_short_circuit_as_ternary_operation)     \
// The End
