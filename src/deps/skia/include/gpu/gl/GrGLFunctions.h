
/*
 * Copyright 2012 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrGLFunctions_DEFINED
#define GrGLFunctions_DEFINED

#include <cstring>
#include "include/gpu/gl/GrGLTypes.h"
#include "include/private/SkTLogic.h"


extern "C" {

///////////////////////////////////////////////////////////////////////////////

using GrGLActiveTextureFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum texture);
using GrGLAttachShaderFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLuint shader);
using GrGLBeginQueryFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLuint id);
using GrGLBindAttribLocationFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLuint index, const char* name);
using GrGLBindBufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLuint buffer);
using GrGLBindFramebufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLuint framebuffer);
using GrGLBindRenderbufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLuint renderbuffer);
using GrGLBindTextureFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLuint texture);
using GrGLBindFragDataLocationFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLuint colorNumber, const GrGLchar* name);
using GrGLBindFragDataLocationIndexedFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLuint colorNumber, GrGLuint index, const GrGLchar* name);
using GrGLBindSamplerFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint unit, GrGLuint sampler);
using GrGLBindVertexArrayFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint array);
using GrGLBlendBarrierFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLBlendColorFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLclampf red, GrGLclampf green, GrGLclampf blue, GrGLclampf alpha);
using GrGLBlendEquationFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode);
using GrGLBlendFuncFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum sfactor, GrGLenum dfactor);
using GrGLBlitFramebufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint srcX0, GrGLint srcY0, GrGLint srcX1, GrGLint srcY1, GrGLint dstX0, GrGLint dstY0, GrGLint dstX1, GrGLint dstY1, GrGLbitfield mask, GrGLenum filter);
using GrGLBufferDataFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLsizeiptr size, const GrGLvoid* data, GrGLenum usage);
using GrGLBufferSubDataFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLintptr offset, GrGLsizeiptr size, const GrGLvoid* data);
using GrGLCheckFramebufferStatusFn = GrGLenum GR_GL_FUNCTION_TYPE(GrGLenum target);
using GrGLClearFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLbitfield mask);
using GrGLClearColorFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLclampf red, GrGLclampf green, GrGLclampf blue, GrGLclampf alpha);
using GrGLClearStencilFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint s);
using GrGLClearTexImageFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint texture, GrGLint level, GrGLenum format, GrGLenum type, const GrGLvoid* data);
using GrGLClearTexSubImageFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint texture, GrGLint level, GrGLint xoffset, GrGLint yoffset, GrGLint zoffset, GrGLsizei width, GrGLsizei height, GrGLsizei depth, GrGLenum format, GrGLenum type, const GrGLvoid* data);
using GrGLColorMaskFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLboolean red, GrGLboolean green, GrGLboolean blue, GrGLboolean alpha);
using GrGLCompileShaderFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint shader);
using GrGLCompressedTexImage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLenum internalformat, GrGLsizei width, GrGLsizei height, GrGLint border, GrGLsizei imageSize, const GrGLvoid* data);
using GrGLCompressedTexSubImage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLint xoffset, GrGLint yoffset, GrGLsizei width, GrGLsizei height, GrGLenum format, GrGLsizei imageSize, const GrGLvoid* data);
using GrGLCopyTexSubImage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLint xoffset, GrGLint yoffset, GrGLint x, GrGLint y, GrGLsizei width, GrGLsizei height);
using GrGLCreateProgramFn = GrGLuint GR_GL_FUNCTION_TYPE();
using GrGLCreateShaderFn = GrGLuint GR_GL_FUNCTION_TYPE(GrGLenum type);
using GrGLCullFaceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode);
using GrGLDeleteBuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* buffers);
using GrGLDeleteFencesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* fences);
using GrGLDeleteFramebuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* framebuffers);
using GrGLDeleteProgramFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program);
using GrGLDeleteQueriesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* ids);
using GrGLDeleteRenderbuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* renderbuffers);
using GrGLDeleteSamplersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei count, const GrGLuint* samplers);
using GrGLDeleteShaderFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint shader);
using GrGLDeleteTexturesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* textures);
using GrGLDeleteVertexArraysFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLuint* arrays);
using GrGLDepthMaskFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLboolean flag);
using GrGLDisableFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum cap);
using GrGLDisableVertexAttribArrayFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint index);
using GrGLDrawArraysFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLint first, GrGLsizei count);
using GrGLDrawArraysInstancedFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLint first, GrGLsizei count, GrGLsizei primcount);
using GrGLDrawArraysIndirectFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, const GrGLvoid* indirect);
using GrGLDrawBufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode);
using GrGLDrawBuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, const GrGLenum* bufs);
using GrGLDrawElementsFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLsizei count, GrGLenum type, const GrGLvoid* indices);
using GrGLDrawElementsInstancedFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLsizei count, GrGLenum type, const GrGLvoid* indices, GrGLsizei primcount);
using GrGLDrawElementsIndirectFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLenum type, const GrGLvoid* indirect);
using GrGLDrawRangeElementsFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLuint start, GrGLuint end, GrGLsizei count, GrGLenum type, const GrGLvoid* indices);
using GrGLEnableFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum cap);
using GrGLEnableVertexAttribArrayFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint index);
using GrGLEndQueryFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target);
using GrGLFinishFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLFinishFenceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint fence);
using GrGLFlushFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLFlushMappedBufferRangeFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLintptr offset, GrGLsizeiptr length);
using GrGLFramebufferRenderbufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum attachment, GrGLenum renderbuffertarget, GrGLuint renderbuffer);
using GrGLFramebufferTexture2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum attachment, GrGLenum textarget, GrGLuint texture, GrGLint level);
using GrGLFramebufferTexture2DMultisampleFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum attachment, GrGLenum textarget, GrGLuint texture, GrGLint level, GrGLsizei samples);
using GrGLFrontFaceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode);
using GrGLGenBuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* buffers);
using GrGLGenFencesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* fences);
using GrGLGenFramebuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* framebuffers);
using GrGLGenerateMipmapFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target);
using GrGLGenQueriesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* ids);
using GrGLGenRenderbuffersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* renderbuffers);
using GrGLGenSamplersFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei count, GrGLuint* samplers);
using GrGLGenTexturesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* textures);
using GrGLGenVertexArraysFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei n, GrGLuint* arrays);
using GrGLGetBufferParameterivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum pname, GrGLint* params);
using GrGLGetErrorFn = GrGLenum GR_GL_FUNCTION_TYPE();
using GrGLGetFramebufferAttachmentParameterivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum attachment, GrGLenum pname, GrGLint* params);
using GrGLGetIntegervFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum pname, GrGLint* params);
using GrGLGetMultisamplefvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum pname, GrGLuint index, GrGLfloat* val);
using GrGLGetProgramBinaryFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLsizei bufsize, GrGLsizei* length, GrGLenum* binaryFormat, void* binary);
using GrGLGetProgramInfoLogFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLsizei bufsize, GrGLsizei* length, char* infolog);
using GrGLGetProgramivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLenum pname, GrGLint* params);
using GrGLGetQueryivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum GLtarget, GrGLenum pname, GrGLint* params);
using GrGLGetQueryObjecti64vFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint id, GrGLenum pname, GrGLint64* params);
using GrGLGetQueryObjectivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint id, GrGLenum pname, GrGLint* params);
using GrGLGetQueryObjectui64vFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint id, GrGLenum pname, GrGLuint64* params);
using GrGLGetQueryObjectuivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint id, GrGLenum pname, GrGLuint* params);
using GrGLGetRenderbufferParameterivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum pname, GrGLint* params);
using GrGLGetShaderInfoLogFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint shader, GrGLsizei bufsize, GrGLsizei* length, char* infolog);
using GrGLGetShaderivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint shader, GrGLenum pname, GrGLint* params);
using GrGLGetShaderPrecisionFormatFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum shadertype, GrGLenum precisiontype, GrGLint* range, GrGLint* precision);
using GrGLGetStringFn = const GrGLubyte* GR_GL_FUNCTION_TYPE(GrGLenum name);
using GrGLGetStringiFn = const GrGLubyte* GR_GL_FUNCTION_TYPE(GrGLenum name, GrGLuint index);
using GrGLGetTexLevelParameterivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLenum pname, GrGLint* params);
using GrGLGetUniformLocationFn = GrGLint GR_GL_FUNCTION_TYPE(GrGLuint program, const char* name);
using GrGLInsertEventMarkerFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei length, const char* marker);
using GrGLInvalidateBufferDataFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint buffer);
using GrGLInvalidateBufferSubDataFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint buffer, GrGLintptr offset, GrGLsizeiptr length);
using GrGLInvalidateFramebufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLsizei numAttachments, const GrGLenum* attachments);
using GrGLInvalidateSubFramebufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLsizei numAttachments, const GrGLenum* attachments, GrGLint x, GrGLint y, GrGLsizei width, GrGLsizei height);
using GrGLInvalidateTexImageFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint texture, GrGLint level);
using GrGLInvalidateTexSubImageFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint texture, GrGLint level, GrGLint xoffset, GrGLint yoffset, GrGLint zoffset, GrGLsizei width, GrGLsizei height, GrGLsizei depth);
using GrGLIsTextureFn = GrGLboolean GR_GL_FUNCTION_TYPE(GrGLuint texture);
using GrGLLineWidthFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLfloat width);
using GrGLLinkProgramFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program);
using GrGLMapBufferFn = GrGLvoid* GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum access);
using GrGLMapBufferRangeFn = GrGLvoid* GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLintptr offset, GrGLsizeiptr length, GrGLbitfield access);
using GrGLMapBufferSubDataFn = GrGLvoid* GR_GL_FUNCTION_TYPE(GrGLuint target, GrGLintptr offset, GrGLsizeiptr size, GrGLenum access);
using GrGLMapTexSubImage2DFn = GrGLvoid* GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLint xoffset, GrGLint yoffset, GrGLsizei width, GrGLsizei height, GrGLenum format, GrGLenum type, GrGLenum access);
using GrGLMemoryBarrierFn = GrGLvoid* GR_GL_FUNCTION_TYPE(GrGLbitfield barriers);
using GrGLPatchParameteriFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum pname, GrGLint value);
using GrGLPixelStoreiFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum pname, GrGLint param);
using GrGLPolygonModeFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum face, GrGLenum mode);
using GrGLPopGroupMarkerFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLProgramBinaryFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLenum binaryFormat, void* binary, GrGLsizei length);
using GrGLProgramParameteriFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLenum pname, GrGLint value);
using GrGLPushGroupMarkerFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsizei length, const char* marker);
using GrGLQueryCounterFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint id, GrGLenum target);
using GrGLReadBufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum src);
using GrGLReadPixelsFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint x, GrGLint y, GrGLsizei width, GrGLsizei height, GrGLenum format, GrGLenum type, GrGLvoid* pixels);
using GrGLRenderbufferStorageFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum internalformat, GrGLsizei width, GrGLsizei height);
using GrGLRenderbufferStorageMultisampleFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLsizei samples, GrGLenum internalformat, GrGLsizei width, GrGLsizei height);
using GrGLResolveMultisampleFramebufferFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLSamplerParameteriFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint sampler, GrGLenum pname, GrGLint params);
using GrGLSamplerParameterivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint sampler, GrGLenum pname, const GrGLint* params);
using GrGLScissorFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint x, GrGLint y, GrGLsizei width, GrGLsizei height);
// GL_CHROMIUM_bind_uniform_location
using GrGLBindUniformLocationFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program, GrGLint location, const char* name);
using GrGLSetFenceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint fence, GrGLenum condition);
using GrGLShaderSourceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint shader, GrGLsizei count, const char* const* str, const GrGLint* length);
using GrGLStencilFuncFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum func, GrGLint ref, GrGLuint mask);
using GrGLStencilFuncSeparateFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum face, GrGLenum func, GrGLint ref, GrGLuint mask);
using GrGLStencilMaskFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint mask);
using GrGLStencilMaskSeparateFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum face, GrGLuint mask);
using GrGLStencilOpFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum fail, GrGLenum zfail, GrGLenum zpass);
using GrGLStencilOpSeparateFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum face, GrGLenum fail, GrGLenum zfail, GrGLenum zpass);
using GrGLTexBufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum internalformat, GrGLuint buffer);
using GrGLTexBufferRangeFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum internalformat, GrGLuint buffer, GrGLintptr offset, GrGLsizeiptr size);
using GrGLTexImage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLint internalformat, GrGLsizei width, GrGLsizei height, GrGLint border, GrGLenum format, GrGLenum type, const GrGLvoid* pixels);
using GrGLTexParameterfFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum pname, GrGLfloat param);
using GrGLTexParameterfvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum pname, const GrGLfloat* params);
using GrGLTexParameteriFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum pname, GrGLint param);
using GrGLTexParameterivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum pname, const GrGLint* params);
using GrGLTexStorage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLsizei levels, GrGLenum internalformat, GrGLsizei width, GrGLsizei height);
using GrGLDiscardFramebufferFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLsizei numAttachments, const GrGLenum* attachments);
using GrGLTestFenceFn = GrGLboolean GR_GL_FUNCTION_TYPE(GrGLuint fence);
using GrGLTexSubImage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLint level, GrGLint xoffset, GrGLint yoffset, GrGLsizei width, GrGLsizei height, GrGLenum format, GrGLenum type, const GrGLvoid* pixels);
using GrGLTextureBarrierFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLUniform1fFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLfloat v0);
using GrGLUniform1iFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLint v0);
using GrGLUniform1fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLfloat* v);
using GrGLUniform1ivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLint* v);
using GrGLUniform2fFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLfloat v0, GrGLfloat v1);
using GrGLUniform2iFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLint v0, GrGLint v1);
using GrGLUniform2fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLfloat* v);
using GrGLUniform2ivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLint* v);
using GrGLUniform3fFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLfloat v0, GrGLfloat v1, GrGLfloat v2);
using GrGLUniform3iFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLint v0, GrGLint v1, GrGLint v2);
using GrGLUniform3fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLfloat* v);
using GrGLUniform3ivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLint* v);
using GrGLUniform4fFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLfloat v0, GrGLfloat v1, GrGLfloat v2, GrGLfloat v3);
using GrGLUniform4iFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLint v0, GrGLint v1, GrGLint v2, GrGLint v3);
using GrGLUniform4fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLfloat* v);
using GrGLUniform4ivFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, const GrGLint* v);
using GrGLUniformMatrix2fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, GrGLboolean transpose, const GrGLfloat* value);
using GrGLUniformMatrix3fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, GrGLboolean transpose, const GrGLfloat* value);
using GrGLUniformMatrix4fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint location, GrGLsizei count, GrGLboolean transpose, const GrGLfloat* value);
using GrGLUnmapBufferFn = GrGLboolean GR_GL_FUNCTION_TYPE(GrGLenum target);
using GrGLUnmapBufferSubDataFn = GrGLvoid GR_GL_FUNCTION_TYPE(const GrGLvoid* mem);
using GrGLUnmapTexSubImage2DFn = GrGLvoid GR_GL_FUNCTION_TYPE(const GrGLvoid* mem);
using GrGLUseProgramFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint program);
using GrGLVertexAttrib1fFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint indx, const GrGLfloat value);
using GrGLVertexAttrib2fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint indx, const GrGLfloat* values);
using GrGLVertexAttrib3fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint indx, const GrGLfloat* values);
using GrGLVertexAttrib4fvFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint indx, const GrGLfloat* values);
using GrGLVertexAttribDivisorFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint index, GrGLuint divisor);
using GrGLVertexAttribIPointerFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint indx, GrGLint size, GrGLenum type, GrGLsizei stride, const GrGLvoid* ptr);
using GrGLVertexAttribPointerFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint indx, GrGLint size, GrGLenum type, GrGLboolean normalized, GrGLsizei stride, const GrGLvoid* ptr);
using GrGLViewportFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLint x, GrGLint y, GrGLsizei width, GrGLsizei height);

/* GL_NV_framebuffer_mixed_samples */
using GrGLCoverageModulationFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum components);

/* EXT_base_instance */
using GrGLDrawArraysInstancedBaseInstanceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLint first, GrGLsizei count, GrGLsizei instancecount, GrGLuint baseinstance);
using GrGLDrawElementsInstancedBaseVertexBaseInstanceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLsizei count, GrGLenum type, const void *indices, GrGLsizei instancecount, GrGLint basevertex, GrGLuint baseinstance);

/* EXT_multi_draw_indirect */
using GrGLMultiDrawArraysIndirectFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, const GrGLvoid* indirect, GrGLsizei drawcount, GrGLsizei stride);
using GrGLMultiDrawElementsIndirectFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLenum type, const GrGLvoid* indirect, GrGLsizei drawcount, GrGLsizei stride);

/* ANGLE_base_vertex_base_instance */
using GrGLMultiDrawArraysInstancedBaseInstanceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, const GrGLint* firsts, const GrGLsizei* counts, const GrGLsizei* instanceCounts, const GrGLuint* baseInstances, const GrGLsizei drawcount);
using GrGLMultiDrawElementsInstancedBaseVertexBaseInstanceFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, const GrGLint* counts, GrGLenum type, const GrGLvoid* const* indices, const GrGLsizei* instanceCounts, const GrGLint* baseVertices, const GrGLuint* baseInstances, const GrGLsizei drawcount);

/* ARB_sync */
using GrGLFenceSyncFn = GrGLsync GR_GL_FUNCTION_TYPE(GrGLenum condition, GrGLbitfield flags);
using GrGLIsSyncFn = GrGLboolean GR_GL_FUNCTION_TYPE(GrGLsync sync);
using GrGLClientWaitSyncFn = GrGLenum GR_GL_FUNCTION_TYPE(GrGLsync sync, GrGLbitfield flags, GrGLuint64 timeout);
using GrGLWaitSyncFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsync sync, GrGLbitfield flags, GrGLuint64 timeout);
using GrGLDeleteSyncFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLsync sync);

/* ARB_internalformat_query */
using GrGLGetInternalformativFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum target, GrGLenum internalformat, GrGLenum pname, GrGLsizei bufSize, GrGLint* params);

/* KHR_debug */
using GrGLDebugMessageControlFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum source, GrGLenum type, GrGLenum severity, GrGLsizei count, const GrGLuint* ids, GrGLboolean enabled);
using GrGLDebugMessageInsertFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum source, GrGLenum type, GrGLuint id, GrGLenum severity, GrGLsizei length, const GrGLchar* buf);
using GrGLDebugMessageCallbackFn = GrGLvoid GR_GL_FUNCTION_TYPE(GRGLDEBUGPROC callback, const GrGLvoid* userParam);
using GrGLGetDebugMessageLogFn = GrGLuint GR_GL_FUNCTION_TYPE(GrGLuint count, GrGLsizei bufSize, GrGLenum* sources, GrGLenum* types, GrGLuint* ids, GrGLenum* severities, GrGLsizei* lengths, GrGLchar* messageLog);
using GrGLPushDebugGroupFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum source, GrGLuint id, GrGLsizei length, const GrGLchar* message);
using GrGLPopDebugGroupFn = GrGLvoid GR_GL_FUNCTION_TYPE();
using GrGLObjectLabelFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum identifier, GrGLuint name, GrGLsizei length, const GrGLchar* label);

/** EXT_window_rectangles */
using GrGLWindowRectanglesFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLenum mode, GrGLsizei count, const GrGLint box[]);

/** GL_QCOM_tiled_rendering */
using GrGLStartTilingFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLuint x, GrGLuint y, GrGLuint width, GrGLuint height, GrGLbitfield preserveMask);
using GrGLEndTilingFn = GrGLvoid GR_GL_FUNCTION_TYPE(GrGLbitfield preserveMask);

/** EGL functions */
using GrEGLQueryStringFn = const char* GR_GL_FUNCTION_TYPE(GrEGLDisplay dpy, GrEGLint name);
using GrEGLGetCurrentDisplayFn = GrEGLDisplay GR_GL_FUNCTION_TYPE();
using GrEGLCreateImageFn = GrEGLImage GR_GL_FUNCTION_TYPE(GrEGLDisplay dpy, GrEGLContext ctx, GrEGLenum target, GrEGLClientBuffer buffer, const GrEGLint* attrib_list);
using GrEGLDestroyImageFn = GrEGLBoolean GR_GL_FUNCTION_TYPE(GrEGLDisplay dpy, GrEGLImage image);
}  // extern "C"

// This is a lighter-weight std::function, trying to reduce code size and compile time
// by only supporting the exact use cases we require.
template <typename T> class GrGLFunction;

template <typename R, typename... Args>
class GrGLFunction<R GR_GL_FUNCTION_TYPE(Args...)> {
public:
    using Fn = R GR_GL_FUNCTION_TYPE(Args...);
    // Construct empty.
    GrGLFunction() = default;
    GrGLFunction(std::nullptr_t) {}

    // Construct from a simple function pointer.
    GrGLFunction(Fn* fn_ptr) {
        static_assert(sizeof(fn_ptr) <= sizeof(fBuf), "fBuf is too small");
        if (fn_ptr) {
            memcpy(fBuf, &fn_ptr, sizeof(fn_ptr));
            fCall = [](const void* buf, Args... args) {
                return (*(Fn**)buf)(std::forward<Args>(args)...);
            };
        }
    }

    // Construct from a small closure.
    template <typename Closure>
    GrGLFunction(Closure closure) : GrGLFunction() {
        static_assert(sizeof(Closure) <= sizeof(fBuf), "fBuf is too small");
#if defined(__APPLE__)  // I am having serious trouble getting these to work with all STLs...
        static_assert(std::is_trivially_copyable<Closure>::value, "");
        static_assert(std::is_trivially_destructible<Closure>::value, "");
#endif

        memcpy(fBuf, &closure, sizeof(closure));
        fCall = [](const void* buf, Args... args) {
            auto closure = (const Closure*)buf;
            return (*closure)(args...);
        };
    }

    R operator()(Args... args) const {
        SkASSERT(fCall);
        return fCall(fBuf, std::forward<Args>(args)...);
    }

    explicit operator bool() const { return fCall != nullptr; }

    void reset() { fCall = nullptr; }

private:
    using Call = R(const void* buf, Args...);
    Call* fCall = nullptr;
    size_t fBuf[4];
};

#endif
