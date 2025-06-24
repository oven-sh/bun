# https://github.com/oven-sh/WebKit/blob/main/Tools/lldb/lldb_webkit.py

# Copyright (C) 2012-2024 Apple Inc. All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions
# are met:
# 1.  Redistributions of source code must retain the above copyright
#     notice, this list of conditions and the following disclaimer.
# 2.  Redistributions in binary form must reproduce the above copyright
#     notice, this list of conditions and the following disclaimer in the
#     documentation and/or other materials provided with the distribution.
#
# THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS'' AND ANY
# EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
# WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
# DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS BE LIABLE FOR ANY
# DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
# (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
# LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
# ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
# (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
# SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

"""
    LLDB Support for WebKit Types

    Add the following to your .lldbinit file to add WebKit Type summaries in LLDB and Xcode:

    command script import {Path to WebKit Root}/Tools/lldb/lldb_webkit.py

"""

import re
import string
import struct
import sys

import lldb

if sys.version_info >= (3, 10):
    # The key argument was added in 3.10.
    from bisect import bisect_right
else:
    def bisect_right(a, x, lo=0, hi=None, *, key=lambda x: x):
        if lo < 0:
            raise ValueError('lo must be non-negative')
        if hi is None:
            hi = len(a)
        while lo < hi:
            mid = (lo + hi) // 2
            if x < key(a[mid]):
                hi = mid
            else:
                lo = mid + 1
        return lo


def addSummaryAndSyntheticFormattersForRawBitmaskType(debugger, type_name, enumerator_value_to_name_map, flags_mask=None):
    class GeneratedRawBitmaskProvider(RawBitmaskProviderBase):
        ENUMERATOR_VALUE_TO_NAME_MAP = enumerator_value_to_name_map.copy()
        FLAGS_MASK = flags_mask

    def raw_bitmask_summary_provider(valobj, dict):
        provider = GeneratedRawBitmaskProvider(valobj, dict)
        return "{ size = %d }" % provider.size

    # Add the provider class and summary function to the global scope so that LLDB
    # can find them.
    python_type_name = type_name.replace('::', '')  # Remove qualifications (e.g. WebCore::X becomes WebCoreX)
    synthetic_provider_class_name = python_type_name + 'Provider'
    summary_provider_function_name = python_type_name + '_SummaryProvider'
    globals()[synthetic_provider_class_name] = GeneratedRawBitmaskProvider
    globals()[summary_provider_function_name] = raw_bitmask_summary_provider

    debugger.HandleCommand('type summary add --expand -F lldb_webkit.%s "%s"' % (summary_provider_function_name, type_name))
    debugger.HandleCommand('type synthetic add %s --python-class lldb_webkit.%s' % (type_name, synthetic_provider_class_name))


def __lldb_init_module(debugger, dict):
    debugger.HandleCommand('command script add -f lldb_webkit.btjs btjs')
    debugger.HandleCommand('command script add -f lldb_webkit.llintLocate llintLocate')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFString_SummaryProvider WTF::String')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFStringImpl_SummaryProvider WTF::StringImpl')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFStringView_SummaryProvider WTF::StringView')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFAtomString_SummaryProvider WTF::AtomString')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFVector_SummaryProvider -x "^WTF::Vector<.+>$"')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFHashTable_SummaryProvider -x "^WTF::HashTable<.+>$"')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFHashMap_SummaryProvider -x "^WTF::HashMap<.+>$"')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFHashSet_SummaryProvider -x "^WTF::HashSet<.+>$"')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFMediaTime_SummaryProvider WTF::MediaTime')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFOptionSet_SummaryProvider -x "^WTF::OptionSet<.+>$"')
    debugger.HandleCommand('type summary add --expand -F lldb_webkit.WTFCompactPointerTuple_SummaryProvider -x "^WTF::CompactPointerTuple<.+,.+>$"')

    debugger.HandleCommand('type summary add -F lldb_webkit.WTFURL_SummaryProvider WTF::URL')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreColor_SummaryProvider WebCore::Color')

    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreLayoutUnit_SummaryProvider WebCore::LayoutUnit')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreLayoutSize_SummaryProvider WebCore::LayoutSize')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreLayoutPoint_SummaryProvider WebCore::LayoutPoint')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreLayoutRect_SummaryProvider WebCore::LayoutRect')

    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreIntSize_SummaryProvider WebCore::IntSize')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreIntPoint_SummaryProvider WebCore::IntPoint')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreIntRect_SummaryProvider WebCore::IntRect')

    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreFloatSize_SummaryProvider WebCore::FloatSize')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreFloatPoint_SummaryProvider WebCore::FloatPoint')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreFloatRect_SummaryProvider WebCore::FloatRect')

    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreLength_SummaryProvider WebCore::Length')

    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreSecurityOrigin_SummaryProvider WebCore::SecurityOrigin')
    debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreFrame_SummaryProvider WebCore::Frame')

    for className in ['Document', 'FTPDirectoryDocument', 'HTMLDocument', 'ImageDocument', 'MediaDocument', 'PluginDocument', 'SVGDocument', 'SinkDocument', 'TextDocument', 'XMLDocument']:
        debugger.HandleCommand('type summary add -F lldb_webkit.WebCoreDocument_SummaryProvider WebCore::' + className)

    # synthetic types (see <https://lldb.llvm.org/varformats.html>)
    debugger.HandleCommand('type synthetic add -x "^WTF::Vector<.+>$" --python-class lldb_webkit.WTFVectorProvider')
    debugger.HandleCommand('type synthetic add -x "^WTF::HashTable<.+>$" --python-class lldb_webkit.WTFHashTableProvider')
    debugger.HandleCommand('type synthetic add -x "^WTF::OptionSet<.+>$" --python-class lldb_webkit.WTFOptionSetProvider')
    debugger.HandleCommand('type synthetic add -x "^WTF::CompactPointerTuple<.+,.+>$" --python-class lldb_webkit.WTFCompactPointerTupleProvider')

    addSummaryAndSyntheticFormattersForRawBitmaskType(debugger, "WebEventFlags", {
        0x00010000: "WebEventFlagMaskLeftCommandKey",
        0x00020000: "WebEventFlagMaskLeftShiftKey",
        0x00040000: "WebEventFlagMaskLeftCapsLockKey",
        0x00080000: "WebEventFlagMaskLeftOptionKey",
        0x00100000: "WebEventFlagMaskLeftControlKey",
        0x00800000: "WebEventFlagMaskRightControlKey",
        0x00200000: "WebEventFlagMaskRightShiftKey",
        0x00400000: "WebEventFlagMaskRightOptionKey",
        0x01000000: "WebEventFlagMaskRightCommandKey",
    })

    # AppKit
    NSEventModifierFlagDeviceIndependentFlagsMask = 0xffff0000
    addSummaryAndSyntheticFormattersForRawBitmaskType(debugger, "NSEventModifierFlags", {
        1 << 16: "NSEventModifierFlagCapsLock",
        1 << 17: "NSEventModifierFlagShift",
        1 << 18: "NSEventModifierFlagControl",
        1 << 19: "NSEventModifierFlagOption",
        1 << 20: "NSEventModifierFlagCommand",
        1 << 21: "NSEventModifierFlagNumericPad",
        1 << 22: "NSEventModifierFlagHelp",
        1 << 23: "NSEventModifierFlagFunction",
    }, flags_mask=NSEventModifierFlagDeviceIndependentFlagsMask)


def WTFString_SummaryProvider(valobj, dict):
    provider = WTFStringProvider(valobj, dict)
    return "{ length = %d, contents = '%s' }" % (provider.get_length(), provider.to_string())


def WTFStringImpl_SummaryProvider(valobj, dict):
    provider = WTFStringImplProvider(valobj, dict)
    if not provider.is_initialized():
        return ""
    return "{ length = %d, is8bit = %d, contents = '%s' }" % (provider.get_length(), provider.is_8bit(), provider.to_string())


def WTFStringView_SummaryProvider(valobj, dict):
    provider = WTFStringViewProvider(valobj, dict)
    return "{ length = %d, contents = '%s' }" % (provider.get_length(), provider.to_string())


def WTFAtomString_SummaryProvider(valobj, dict):
    return WTFString_SummaryProvider(valobj.GetChildMemberWithName('m_string'), dict)


def WTFVector_SummaryProvider(valobj, dict):
    provider = WTFVectorProvider(valobj, dict)
    return "{ size = %d, capacity = %d }" % (provider.size, provider.capacity)


def WTFHashTable_SummaryProvider(valobj, dict):
    provider = WTFHashTableProvider(valobj, dict)
    return "{ tableSize = %d, keyCount = %d }" % (provider.tableSize(), provider.keyCount())


def WTFHashMap_SummaryProvider(valobj, dict):
    provider = WTFHashMapProvider(valobj, dict)
    return "{ tableSize = %d, keyCount = %d }" % (provider.tableSize(), provider.keyCount())


def WTFHashSet_SummaryProvider(valobj, dict):
    provider = WTFHashSetProvider(valobj, dict)
    return "{ tableSize = %d, keyCount = %d }" % (provider.tableSize(), provider.keyCount())


def WTFOptionSet_SummaryProvider(valobj, dict):
    provider = WTFOptionSetProvider(valobj, dict)
    return "{ size = %d }" % provider.size


def WTFMediaTime_SummaryProvider(valobj, dict):
    provider = WTFMediaTimeProvider(valobj, dict)
    if provider.isInvalid():
        return "{ Invalid }"
    if provider.isPositiveInfinity():
        return "{ +Infinity }"
    if provider.isNegativeInfinity():
        return "{ -Infinity }"
    if provider.isIndefinite():
        return "{ Indefinite }"
    if provider.hasDoubleValue():
        return "{ %f }" % (provider.timeValueAsDouble())
    return "{ %d/%d, %f }" % (provider.timeValue(), provider.timeScale(), float(provider.timeValue()) / provider.timeScale())


def WTFCompactPointerTuple_SummaryProvider(valobj, dict):
    provider = WTFCompactPointerTupleProvider(valobj, dict)
    return "{ type = %s }" % provider.type_as_string()


def WebCoreColor_SummaryProvider(valobj, dict):
    provider = WebCoreColorProvider(valobj, dict)
    return "{ %s }" % provider.to_string()


def WTFURL_SummaryProvider(valobj, dict):
    provider = WTFURLProvider(valobj, dict)
    return "{ %s }" % provider.to_string()


def WebCoreLayoutUnit_SummaryProvider(valobj, dict):
    provider = WebCoreLayoutUnitProvider(valobj, dict)
    return "{ %s }" % provider.to_string()


def WebCoreLayoutSize_SummaryProvider(valobj, dict):
    provider = WebCoreLayoutSizeProvider(valobj, dict)
    return "{ width = %s, height = %s }" % (provider.get_width(), provider.get_height())


def WebCoreLayoutPoint_SummaryProvider(valobj, dict):
    provider = WebCoreLayoutPointProvider(valobj, dict)
    return "{ x = %s, y = %s }" % (provider.get_x(), provider.get_y())


def WebCoreLayoutRect_SummaryProvider(valobj, dict):
    provider = WebCoreLayoutRectProvider(valobj, dict)
    return "{ x = %s, y = %s, width = %s, height = %s }" % (provider.get_x(), provider.get_y(), provider.get_width(), provider.get_height())


def WebCoreIntSize_SummaryProvider(valobj, dict):
    provider = WebCoreIntSizeProvider(valobj, dict)
    return "{ width = %s, height = %s }" % (provider.get_width(), provider.get_height())


def WebCoreIntPoint_SummaryProvider(valobj, dict):
    provider = WebCoreIntPointProvider(valobj, dict)
    return "{ x = %s, y = %s }" % (provider.get_x(), provider.get_y())


def WebCoreFloatSize_SummaryProvider(valobj, dict):
    provider = WebCoreFloatSizeProvider(valobj, dict)
    return "{ width = %s, height = %s }" % (provider.get_width(), provider.get_height())


def WebCoreFloatPoint_SummaryProvider(valobj, dict):
    provider = WebCoreFloatPointProvider(valobj, dict)
    return "{ x = %s, y = %s }" % (provider.get_x(), provider.get_y())


def WebCoreIntRect_SummaryProvider(valobj, dict):
    provider = WebCoreIntRectProvider(valobj, dict)
    return "{ x = %s, y = %s, width = %s, height = %s }" % (provider.get_x(), provider.get_y(), provider.get_width(), provider.get_height())


def WebCoreFloatRect_SummaryProvider(valobj, dict):
    provider = WebCoreFloatRectProvider(valobj, dict)
    return "{ x = %s, y = %s, width = %s, height = %s }" % (provider.get_x(), provider.get_y(), provider.get_width(), provider.get_height())


def WebCoreLength_SummaryProvider(valobj, dict):
    provider = WebCoreLengthProvider(valobj, dict)
    quirky = ' (quirky)' if provider.has_quirk() else ""

    if (provider.is_auto()):
        return "{ auto%s }" % (quirky)

    if (provider.is_undefined()):
        return "{ undefined%s }" % (quirky)

    if (provider.is_calculated()):
        return "{ calc%s }" % (quirky)

    if (provider.is_fixed()):
        return "{ %spx%s }" % (provider.get_numeric_value(), quirky)

    if (provider.is_percent()):
        return "{ %s%%%s }" % (provider.get_numeric_value(), quirky)

    return "{ %s %s%s }" % (provider.get_type_string(), provider.get_numeric_value(), quirky)


def WebCoreSecurityOrigin_SummaryProvider(valobj, dict):
    provider = WebCoreSecurityOriginProvider(valobj, dict)
    return '{ %s, domain = %s, hasUniversalAccess = %d }' % (provider.to_string(), provider.domain(), provider.has_universal_access())


def WebCoreFrame_SummaryProvider(valobj, dict):
    provider = WebCoreFrameProvider(valobj, dict)
    document = provider.document()
    if document:
        origin = document.origin()
        url = document.url()
        backForwardCacheState = document.page_cache_state()
    else:
        origin = ''
        url = ''
        backForwardCacheState = ''
    return '{ origin = %s, url = %s, isMainFrame = %d, backForwardCacheState = %s }' % (origin, url, provider.is_main_frame(), backForwardCacheState)


def WebCoreDocument_SummaryProvider(valobj, dict):
    provider = WebCoreDocumentProvider(valobj, dict)
    frame = provider.frame()
    in_main_frame = '%d' % frame.is_main_frame() if frame else 'Detached'
    return '{ origin = %s, url = %s, inMainFrame = %s, backForwardCacheState = %s }' % (provider.origin(), provider.url(), in_main_frame, provider.page_cache_state())


def btjs(debugger, command, result, internal_dict):
    '''Prints a stack trace of current thread with JavaScript frames decoded.  Takes optional frame count argument'''

    target = debugger.GetSelectedTarget()
    addressFormat = '#0{width}x'.format(width=target.GetAddressByteSize() * 2 + 2)
    process = target.GetProcess()
    thread = process.GetSelectedThread()
    jscModule = target.module["JavaScriptCore"] or target.module["bun"] or target.module["bun-debug"]

    if jscModule.FindSymbol("JSC::CallFrame::describeFrame").GetSize() or jscModule.FindSymbol("_ZN3JSC9CallFrame13describeFrameEv").GetSize():
        annotateJSFrames = True
    else:
        annotateJSFrames = False

    if not annotateJSFrames:
        print("Warning: Can't find JSC::CallFrame::describeFrame() in executable to annotate JavaScript frames")

    backtraceDepth = thread.GetNumFrames()

    if len(command) > 0:
        try:
            backtraceDepth = int(command)
        except ValueError:
            return

    threadFormat = '* thread #{num}: tid = {tid:#x}, {pcAddr:' + addressFormat + '}, queue = \'{queueName}, stop reason = {stopReason}'
    # FIXME: GetStopDescription needs to be pass a stupidly large length because lldb has weird utf-8 encoding errors if it's too small. See: rdar://problem/57980599
    print(threadFormat.format(num=thread.GetIndexID(), tid=thread.GetThreadID(), pcAddr=thread.GetFrameAtIndex(0).GetPC(), queueName=thread.GetQueueName(), stopReason=thread.GetStopDescription(300)))

    llintStart = jscModule.FindSymbol("jsc_llint_begin").addr.GetLoadAddress(target)
    llintEnd = jscModule.FindSymbol("jsc_llint_end").addr.GetLoadAddress(target)

    for frame in thread:
        if backtraceDepth < 1:
            break

        backtraceDepth = backtraceDepth - 1

        if annotateJSFrames and (not frame.GetSymbol() or (llintStart < frame.pc and frame.pc < llintEnd)):
            callFrame = frame.GetSP()
            JSFrameDescription = frame.EvaluateExpression("((JSC::CallFrame*)0x%x)->describeFrame()" % frame.GetFP()).GetSummary()
            if not JSFrameDescription:
                JSFrameDescription = frame.EvaluateExpression("(char*)_ZN3JSC9CallFrame13describeFrameEv(0x%x)" % frame.GetFP()).GetSummary()
            if JSFrameDescription:
                JSFrameDescription = JSFrameDescription.strip('"')
                frameFormat = '    frame #{num}: {addr:' + addressFormat + '} {desc}'
                print(frameFormat.format(num=frame.GetFrameID(), addr=frame.GetPC(), desc=JSFrameDescription))
                continue
        print('    %s' % frame)


# FIXME: This seems like we should be able to do this with a formatter https://lldb.llvm.org/use/formatting.html
# If we did we could also add info about what JIT location we're at.
# FIXME: Once rdar://133349487 is resolved we hopefully shouldn't need this anymore.
def llintLocate(debugger, commond, result, internal_dict):
    target = debugger.GetSelectedTarget()
    process = target.GetProcess()
    thread = process.GetSelectedThread()
    jscModule = target.module["JavaScriptCore"]

    frame = thread.GetFrameAtIndex(0)
    pc = frame.GetPC()

    if frame.GetSymbol() and frame.GetSymbol().GetName() == "jsc_llint_begin":
        llintRegex = re.compile("^op_|^llint_|^jsc_|^wasm|^ipint_")
        llintSymbols = jscModule.symbol[llintRegex]

        index = bisect_right(llintSymbols, pc, key=lambda symbol: symbol.addr.GetLoadAddress(target))

        closestSymbol = llintSymbols[index]
        # if we're exactly on a symbol then bisect_right will return the next symbol. In that case we want the "previous" symbol.
        if not closestSymbol or closestSymbol.addr.GetLoadAddress(target) > pc:
            closestSymbol = llintSymbols[index - 1]
        if closestSymbol:
            print("{name} at {pcStart}".format(name=closestSymbol.name, pcStart=closestSymbol.addr))
            return

    print("not in llint")


# FIXME: Provide support for the following types:
# def WTFVector_SummaryProvider(valobj, dict):
# def WTFCString_SummaryProvider(valobj, dict):
# def WebCoreQualifiedName_SummaryProvider(valobj, dict):
# def JSCIdentifier_SummaryProvider(valobj, dict):
# def JSCJSString_SummaryProvider(valobj, dict):


def guess_string_length(valobj, charSize, error):
    if not valobj.GetValue():
        return 0

    maxLength = 256

    pointer = valobj.GetValueAsUnsigned()
    contents = valobj.GetProcess().ReadMemory(pointer, maxLength * charSize, lldb.SBError())
    format = 'B' if charSize == 1 else 'H'

    for i in xrange(0, maxLength):
        if not struct.unpack_from(format, contents, i * charSize)[0]:
            return i

    return maxLength

def ustring_to_string(valobj, error, length=None):
    if length is None:
        length = guess_string_length(valobj, 2, error)
    else:
        length = int(length)

    if length == 0:
        return ""

    pointer = valobj.GetValueAsUnsigned()
    contents = valobj.GetProcess().ReadMemory(pointer, length * 2, lldb.SBError())

    # lldb does not (currently) support returning unicode from python summary providers,
    # so potentially convert this to ascii by escaping
    string = contents.decode('utf16')
    try:
        return str(string)
    except:
        return string.encode('unicode_escape')

def lstring_to_string(valobj, error, length=None):
    if length is None:
        length = guess_string_length(valobj, 1, error)
    else:
        length = int(length)

    if length == 0:
        return ""

    pointer = valobj.GetValueAsUnsigned()
    contents = valobj.GetProcess().ReadMemory(pointer, length, lldb.SBError())
    if not contents:
        return ""

    # lldb does not (currently) support returning unicode from python summary providers,
    # so potentially convert this to ascii by escaping
    string = contents.decode('utf8')
    try:
        return str(string)
    except:
        return string.encode('unicode_escape')

class WTFStringImplProvider:
    def __init__(self, valobj, dict):
        # FIXME: For some reason lldb(1) sometimes has an issue accessing members of WTF::StringImplShape
        # via a WTF::StringImpl pointer (why?). As a workaround we explicitly cast to WTF::StringImplShape*.
        string_impl_shape_ptr_type = valobj.GetTarget().FindFirstType('WTF::StringImplShape').GetPointerType()
        self.valobj = valobj.Cast(string_impl_shape_ptr_type)

    def get_length(self):
        return self.valobj.GetChildMemberWithName('m_length').GetValueAsUnsigned(0)

    def get_data8(self):
        return self.valobj.GetChildAtIndex(2).GetChildMemberWithName('m_data8')

    def get_data16(self):
        return self.valobj.GetChildAtIndex(2).GetChildMemberWithName('m_data16')

    def to_string(self):
        error = lldb.SBError()

        if not self.is_initialized():
            return u""

        if self.is_8bit():
            return lstring_to_string(self.get_data8(), error, self.get_length())
        return ustring_to_string(self.get_data16(), error, self.get_length())

    def is_8bit(self):
        # FIXME: find a way to access WTF::StringImpl::s_hashFlag8BitBuffer
        return bool(self.valobj.GetChildMemberWithName('m_hashAndFlags').GetValueAsUnsigned(0) \
            & 1 << 2)

    def is_initialized(self):
        return self.valobj.GetValueAsUnsigned() != 0


class WTFStringViewProvider:
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def is_8bit(self):
        return bool(self.valobj.GetChildMemberWithName('m_is8Bit').GetValueAsUnsigned(0))

    def get_length(self):
        return self.valobj.GetChildMemberWithName('m_length').GetValueAsUnsigned(0)

    def get_characters(self):
        return self.valobj.GetChildMemberWithName('m_characters')

    def to_string(self):
        error = lldb.SBError()

        if not self.get_characters() or not self.get_length():
            return u""

        if self.is_8bit():
            return lstring_to_string(self.get_characters(), error, self.get_length())
        return ustring_to_string(self.get_characters(), error, self.get_length())


class WTFStringProvider:
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def stringimpl(self):
        impl_ptr = self.valobj.GetChildMemberWithName('m_impl').GetChildMemberWithName('m_ptr')
        return WTFStringImplProvider(impl_ptr, dict)

    def get_length(self):
        impl = self.stringimpl()
        if not impl:
            return 0
        return impl.get_length()

    def to_string(self):
        impl = self.stringimpl()
        if not impl:
            return u""
        return impl.to_string()


class WebCoreColorProvider:
    SEMANTIC_FLAG                           = 1 << 0
    USE_COLOR_FUNCTION_SERIALIZATION_FLAG   = 1 << 1
    VALID_FLAG                              = 1 << 2
    OUT_OF_LINE_FLAG                        = 1 << 3

    COLOR_VALUE_MASK                        = (1 << 48) - 1 # only correct for 64-bit
    FLAGS_SHIFT                             = 48
    FLAGS_SIZE                              = 8
    COLOR_SPACE_SHIFT                       = FLAGS_SHIFT + FLAGS_SIZE

    "Print a WebCore::Color"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def _is_out_of_line(self, rgba_and_flags):
        flags = self._flags(rgba_and_flags)
        return bool(flags & self.OUT_OF_LINE_FLAG)

    def _is_valid(self, rgba_and_flags):
        flags = self._flags(rgba_and_flags)
        return bool(flags & self.VALID_FLAG)

    def _is_semantic(self, rgba_and_flags):
        flags = self._flags(rgba_and_flags)
        return bool(flags & self.SEMANTIC_FLAG)

    def _color_space(self, rgba_and_flags):
        return rgba_and_flags >> self.COLOR_SPACE_SHIFT

    def _flags(self, rgba_and_flags):
        return rgba_and_flags >> self.FLAGS_SHIFT

    def _to_string_out_of_line(self):
        rgba_and_flags = self.valobj.GetChildMemberWithName('m_colorAndFlags').GetValueAsUnsigned(0)

        out_of_line_components_type = self.valobj.GetTarget().FindFirstType('WebCore::Color::OutOfLineComponents')
        out_of_line_components = self.valobj.CreateValueFromAddress('out_of_line_components', rgba_and_flags & self.COLOR_VALUE_MASK, out_of_line_components_type)

        color_space = self._color_space(rgba_and_flags)

        # From ColorSpace.h.
        color_spaces = [
            'A98RGB',
            'DisplayP3',
            'ExtendedA98RGB',
            'ExtendedDisplayP3',
            'ExtendedLinearSRGB',
            'ExtendedProPhotoRGB',
            'ExtendedRec2020',
            'ExtendedSRGB',
            'HSL',
            'HWB',
            'LCH',
            'Lab',
            'LinearSRGB',
            'OKLCH',
            'OKLab',
            'ProPhotoRGB',
            'Rec2020',
            'SRGB',
            'XYZ_D50',
            'XYZ_D65',
        ]

        profile = color_spaces[color_space] if color_space < len(color_spaces) else 'unknown'

        color_components = out_of_line_components.GetChildMemberWithName('m_components')
        std_array_elems = color_components.GetChildMemberWithName('components').GetChildMemberWithName('__elems_')

        red = float(std_array_elems.GetChildAtIndex(0).GetValue())
        green = float(std_array_elems.GetChildAtIndex(1).GetValue())
        blue = float(std_array_elems.GetChildAtIndex(2).GetValue())
        alpha = float(std_array_elems.GetChildAtIndex(3).GetValue())

        semantic = ' semantic' if self._is_semantic(rgba_and_flags) else ""

        return "color(%s %1.2f %1.2f %1.2f / %1.2f)%s" % (profile, red, green, blue, alpha, semantic)

    def to_string(self):
        rgba_and_flags = self.valobj.GetChildMemberWithName('m_colorAndFlags').GetValueAsUnsigned(0)

        if self._is_out_of_line(rgba_and_flags):
            return self._to_string_out_of_line()

        if not self._is_valid(rgba_and_flags):
            return 'invalid'

        color = rgba_and_flags & self.COLOR_VALUE_MASK
        red = (color >> 24) & 0xFF
        green = (color >> 16) & 0xFF
        blue = (color >> 8) & 0xFF
        alpha = (color & 0xFF) / 255.0

        semantic = ' semantic' if self._is_semantic(rgba_and_flags) else ""

        result = 'rgba(%d, %d, %d, %1.2f)%s' % (red, green, blue, alpha, semantic)
        return result


class WebCoreLayoutUnitProvider:
    "Print a WebCore::LayoutUnit"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def to_string(self):
        layoutUnitValue = self.valobj.GetChildMemberWithName('m_value').GetValueAsSigned(0)
        return "%gpx (%d)" % (float(layoutUnitValue) / 64, layoutUnitValue)


class WebCoreLayoutSizeProvider:
    "Print a WebCore::LayoutSize"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_width(self):
        return WebCoreLayoutUnitProvider(self.valobj.GetChildMemberWithName('m_width'), dict).to_string()

    def get_height(self):
        return WebCoreLayoutUnitProvider(self.valobj.GetChildMemberWithName('m_height'), dict).to_string()


class WebCoreLayoutPointProvider:
    "Print a WebCore::LayoutPoint"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_x(self):
        return WebCoreLayoutUnitProvider(self.valobj.GetChildMemberWithName('m_x'), dict).to_string()

    def get_y(self):
        return WebCoreLayoutUnitProvider(self.valobj.GetChildMemberWithName('m_y'), dict).to_string()


class WebCoreLayoutRectProvider:
    "Print a WebCore::LayoutRect"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_x(self):
        return WebCoreLayoutPointProvider(self.valobj.GetChildMemberWithName('m_location'), dict).get_x()

    def get_y(self):
        return WebCoreLayoutPointProvider(self.valobj.GetChildMemberWithName('m_location'), dict).get_y()

    def get_width(self):
        return WebCoreLayoutSizeProvider(self.valobj.GetChildMemberWithName('m_size'), dict).get_width()

    def get_height(self):
        return WebCoreLayoutSizeProvider(self.valobj.GetChildMemberWithName('m_size'), dict).get_height()


class WebCoreIntPointProvider:
    "Print a WebCore::IntPoint"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_x(self):
        return self.valobj.GetChildMemberWithName('m_x').GetValueAsSigned()

    def get_y(self):
        return self.valobj.GetChildMemberWithName('m_y').GetValueAsSigned()


class WebCoreIntSizeProvider:
    "Print a WebCore::IntSize"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_width(self):
        return self.valobj.GetChildMemberWithName('m_width').GetValueAsSigned()

    def get_height(self):
        return self.valobj.GetChildMemberWithName('m_height').GetValueAsSigned()


class WebCoreIntRectProvider:
    "Print a WebCore::IntRect"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_x(self):
        return WebCoreIntPointProvider(self.valobj.GetChildMemberWithName('m_location'), dict).get_x()

    def get_y(self):
        return WebCoreIntPointProvider(self.valobj.GetChildMemberWithName('m_location'), dict).get_y()

    def get_width(self):
        return WebCoreIntSizeProvider(self.valobj.GetChildMemberWithName('m_size'), dict).get_width()

    def get_height(self):
        return WebCoreIntSizeProvider(self.valobj.GetChildMemberWithName('m_size'), dict).get_height()


class WebCoreFloatPointProvider:
    "Print a WebCore::FloatPoint"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_x(self):
        return float(self.valobj.GetChildMemberWithName('m_x').GetValue())

    def get_y(self):
        return float(self.valobj.GetChildMemberWithName('m_y').GetValue())


class WebCoreFloatSizeProvider:
    "Print a WebCore::FloatSize"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_width(self):
        return float(self.valobj.GetChildMemberWithName('m_width').GetValue())

    def get_height(self):
        return float(self.valobj.GetChildMemberWithName('m_height').GetValue())


class WebCoreFloatRectProvider:
    "Print a WebCore::FloatRect"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_x(self):
        return WebCoreFloatPointProvider(self.valobj.GetChildMemberWithName('m_location'), dict).get_x()

    def get_y(self):
        return WebCoreFloatPointProvider(self.valobj.GetChildMemberWithName('m_location'), dict).get_y()

    def get_width(self):
        return WebCoreFloatSizeProvider(self.valobj.GetChildMemberWithName('m_size'), dict).get_width()

    def get_height(self):
        return WebCoreFloatSizeProvider(self.valobj.GetChildMemberWithName('m_size'), dict).get_height()


class WebCoreLengthProvider:
    "Print a WebCore::Length"

    AUTO_TYPE           = 0
    RELATIVE_TYPE       = 1
    PERCENT_TYPE        = 2
    FIXED_TYPE          = 3
    INTRINSIC_TYPE      = 4
    MIN_INTRINSIC_TYPE  = 5
    MIN_CONTENT_TYPE    = 6
    MAX_CONTENT_TYPE    = 7
    FILL_AVAILABLE_TYPE = 8
    FIT_CONTENT_TYPE    = 9
    CALCULATED_TYPE     = 10
    UNDEFINED_TYPE      = 11

    def __init__(self, valobj, dict):
        self.valobj = valobj

    def get_type(self):
        return self.valobj.GetChildMemberWithName('m_type').GetValueAsUnsigned(0)

    def get_type_string(self):
        length_type = self.get_type()

        type_names = [
            "Auto",
            "Relative",
            "Percent",
            "Fixed",
            "Intrinsic",
            "MinIntrinsic",
            "MinContent",
            "MaxContent",
            "FillAvailable",
            "FitContent",
            "Calculated",
            "Undefined",
        ]

        if (length_type <= self.UNDEFINED_TYPE):
            return type_names[length_type]

        return "Unknown"

    def is_auto(self):
        return self.get_type() == self.AUTO_TYPE

    def is_undefined(self):
        return self.get_type() == self.UNDEFINED_TYPE

    def is_calculated(self):
        return self.get_type() == self.CALCULATED_TYPE

    def is_fixed(self):
        return self.get_type() == self.FIXED_TYPE

    def is_percent(self):
        return self.get_type() == self.PERCENT_TYPE

    def has_quirk(self):
        return bool(self.valobj.GetChildMemberWithName('m_hasQuirk').GetValueAsUnsigned(0))

    def is_float(self):
        return bool(self.valobj.GetChildMemberWithName('m_isFloat').GetValueAsUnsigned(0))

    def get_numeric_value(self):
        length_type = self.get_type()
        if (length_type == self.CALCULATED_TYPE):
            return 0

        if (self.is_float()):
            return self.valobj.GetChildMemberWithName('m_floatValue').GetValue()

        return self.valobj.GetChildMemberWithName('m_intValue').GetValueAsSigned()



class WTFURLProvider:
    "Print a WTF::URL"
    def __init__(self, valobj, dict):
        self.valobj = valobj

    def to_string(self):
        return WTFStringProvider(self.valobj.GetChildMemberWithName('m_string'), dict).to_string()


class StdOptionalWrapper:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj

    def has_value(self):
        return bool(self.valobj.GetChildMemberWithName('init_').GetValueAsUnsigned(0))

    def value(self):
        return self.valobj.GetChildMemberWithName('storage_').GetChildMemberWithName('value_')


class WebCoreSecurityOriginProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        self._data_ptr = self.valobj.GetChildMemberWithName('m_data')

    def is_unique(self):
        return bool(self.valobj.GetChildMemberWithName('m_isUnique').GetValueAsUnsigned(0))

    def scheme(self):
        return WTFStringProvider(self._data_ptr.GetChildMemberWithName('protocol'), dict()).to_string()

    def host(self):
        return WTFStringProvider(self._data_ptr.GetChildMemberWithName('host'), dict()).to_string()

    def port(self):
        optional_port = StdOptionalWrapper(self._data_ptr.GetChildMemberWithName('port'), dict())
        if not optional_port.has_value():
            return None
        return optional_port.value().GetValueAsUnsigned(0)

    def domain(self):
        return WTFStringProvider(self.valobj.GetChildMemberWithName('m_domain'), dict()).to_string()

    def has_universal_access(self):
        return bool(self.valobj.GetChildMemberWithName('m_universalAccess').GetValueAsUnsigned(0))

    def to_string(self):
        if self.is_unique():
            return 'Unique'
        scheme = self.scheme()
        host = self.host()
        port = self.port()
        if not scheme and not host and not port:
            return ''
        if scheme == 'file:':
            return 'file://'
        result = '{}://{}'.format(scheme, host)
        if port:
            result += ':' + str(port)
        return result


class WebCoreFrameProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj

    def is_main_frame(self):
        return self.valobj.GetAddress().GetFileAddress() == self.valobj.GetChildMemberWithName('m_mainFrame').GetAddress().GetFileAddress()

    def document(self):
        document_ptr = self.valobj.GetChildMemberWithName('m_doc').GetChildMemberWithName('m_ptr')
        if not document_ptr or not bool(document_ptr.GetValueAsUnsigned(0)):
            return None
        return WebCoreDocumentProvider(document_ptr, dict())


class WebCoreDocumentProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj

    def url(self):
        return WTFURLProvider(self.valobj.GetChildMemberWithName('m_url'), dict()).to_string()

    def origin(self):
        security_origin_ptr = self.valobj.GetChildMemberWithName('m_securityOriginPolicy').GetChildMemberWithName('m_ptr').GetChildMemberWithName('m_securityOrigin').GetChildMemberWithName('m_ptr')
        return WebCoreSecurityOriginProvider(security_origin_ptr, dict()).to_string()

    def page_cache_state(self):
        return self.valobj.GetChildMemberWithName('m_backForwardCacheState').GetValue()

    def frame(self):
        frame_ptr = self.valobj.GetChildMemberWithName('m_frame')
        if not frame_ptr or not bool(frame_ptr.GetValueAsUnsigned(0)):
            return None
        return WebCoreFrameProvider(frame_ptr, dict())


class FlagEnumerationProvider(object):
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        self._elements = []
        self.update()

    # Subclasses must override this to return a dictionary that maps emumerator values to names.
    def _enumerator_value_to_name_map(self):
        pass

    # Subclasses must override this to return the bitmask.
    def _bitmask(self):
        pass

    # Subclasses can override this to perform any computations when LLDB needs to refresh
    # this provider.
    def _update(self):
        pass

    # Subclasses can override this to provide the index that corresponds to the specified name.
    # If this method is overridden then it is also expected that _get_child_at_index() will be
    # overridden to provide the value for the index returned by this method. Note that the
    # returned index must be greater than or equal to self.size in order to avoid breaking
    # printing of synthetic children.
    def _get_child_index(self, name):
        return None

    # Subclasses can override this to provide the SBValue for the specified index. It is only
    # meaningful to override this method if _get_child_index() is also overridden.
    def _get_child_at_index(self, index):
        return None

    @property
    def size(self):
        return len(self._elements)

    # LLDB overrides
    def has_children(self):
        return bool(self._elements)

    def num_children(self):
        return len(self._elements)

    def get_child_index(self, name):
        return self._get_child_index(name)

    def get_child_at_index(self, index):
        if index < 0 or not self.valobj.IsValid():
            return None
        if index < len(self._elements):
            (name, value) = self._elements[index]
            return self.valobj.CreateValueFromExpression(name, str(value))
        return self._get_child_at_index(index)

    def update(self):
        self._update()

        enumerator_value_to_name_map = self._enumerator_value_to_name_map()
        if not enumerator_value_to_name_map:
            return

        bitmask_with_all_options_set = sum(enumerator_value_to_name_map)
        bitmask = self._bitmask()
        if bitmask > bitmask_with_all_options_set:
            return  # Since this is an invalid value, return so the raw hex form is written out.

        # self.valobj looks like it contains a valid value.
        # Iterate from least significant bit to most significant bit.
        elements = []
        while bitmask > 0:
            current = bitmask & -bitmask  # Isolate the rightmost set bit.
            elements.append((enumerator_value_to_name_map[current], current))  # e.g. ('Spelling', 4)
            bitmask = bitmask & (bitmask - 1)  # Turn off the rightmost set bit.
        self._elements = elements

class WTFOptionSetProvider(FlagEnumerationProvider):
    def _enumerator_value_to_name_map(self):
        template_argument_sbType = self.valobj.GetType().GetTemplateArgumentType(0)
        enumerator_value_to_name_map = {}
        for sbTypeEnumMember in template_argument_sbType.get_enum_members_array():
            enumerator_value = sbTypeEnumMember.GetValueAsUnsigned()
            if enumerator_value not in enumerator_value_to_name_map:
                enumerator_value_to_name_map[enumerator_value] = sbTypeEnumMember.GetName()
        return enumerator_value_to_name_map

    def _bitmask(self):
        return self.storage.GetValueAsUnsigned(0)

    def _update(self):
        self.storage = self.valobj.GetChildMemberWithName('m_storage')  # May be an invalid value.

    def _get_child_index(self, name):
        if name == 'm_storage':
            return self.size
        return None

    def _get_child_at_index(self, index):
        if index == self.size:
            return self.storage
        return None


class RawBitmaskProviderBase(FlagEnumerationProvider):
    ENUMERATOR_VALUE_TO_NAME_MAP = {}
    FLAGS_MASK = None  # Useful when a bitmask represents multiple disjoint sets of flags (e.g. NSEventModifierFlags).

    def _enumerator_value_to_name_map(self):
        return self.ENUMERATOR_VALUE_TO_NAME_MAP

    def _bitmask(self):
        result = self.valobj.GetValueAsUnsigned(0)
        if self.FLAGS_MASK is not None:
            result = result & self.FLAGS_MASK
        return result


class WTFCompactPointerTupleProvider(object):

    TYPE_MASK = 0xFFFF000000000000
    POINTER_MASK = ~TYPE_MASK

    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        self._is32Bit = valobj.GetTarget().GetAddressByteSize() == 4
        self._pointer = None
        self._type = None
        self.update()

    def type_as_string(self):
        if not self.is_human_readable_type():
            return "%s" % self._type.GetValueAsUnsigned(0)
        return "%s" % self._type.GetValue()

    def is_human_readable_type(self):
        # The default summary provider for uint8_t, unsigned char emits the ASCII printable character or equivalent
        # C escape sequence (e.g. \a = 0x07). Typically the CompactPointerTuple is used to encode non-character integral
        # data. In this context it is less readable to use the default summary provider. So, we don't.
        return self.valobj.GetType().GetTemplateArgumentType(1).GetBasicType() != lldb.eBasicTypeUnsignedChar

    # LLDB overrides
    def has_children(self):
        return self._type is not None and self._pointer is not None

    def num_children(self):
        if not self.has_children:
            return 0
        return 2

    def get_child_index(self, name):
        if name == '[0]':
            return 0
        if name == '[1]':
            return 1
        if self._is32Bit:
            if name == 'm_pointer':
                return 2
            if name == 'm_type':
                return 3
        else:
            if name == 'm_data':
                return 2
        return None

    def get_child_at_index(self, index):
        if index < 0 or not self.valobj.IsValid():
            return None
        if index == 0:
            return self._pointer
        if index == 1:
            return self._type
        if self._is32Bit:
            if index == 2:
                return self._pointer
            if index == 3:
                return self._type
        else:
            if index == 2:
                return self.valobj.GetChildMemberWithName('m_data')
        return None

    def update(self):
        if self._is32Bit:
            self._pointer = self.valobj.GetChildMemberWithName('m_pointer')
            self._type = self.valobj.GetChildMemberWithName('m_type')
        else:
            data = self.valobj.GetChildMemberWithName('m_data').GetValueAsUnsigned(0)
            byte_order = self.valobj.GetTarget().GetByteOrder()
            address_byte_size = self.valobj.GetTarget().GetAddressByteSize()

            pointer_data = lldb.SBData.CreateDataFromUInt64Array(byte_order, address_byte_size, [data & self.POINTER_MASK])
            self._pointer = self.valobj.CreateValueFromData('[0]', pointer_data, self.valobj.GetType().GetTemplateArgumentType(0))

            type_data = lldb.SBData.CreateDataFromUInt64Array(byte_order, address_byte_size, [(data >> 48) & 0xFFFF])
            type_to_use = self.valobj.GetType().GetTemplateArgumentType(1)
            if not self.is_human_readable_type():
                type_to_use = self.valobj.GetTarget().GetBasicType(lldb.eBasicTypeUnsignedInt)
            self._type = self.valobj.CreateValueFromData('[1]', type_data, type_to_use)


class WTFVectorProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        self.update()

    def num_children(self):
        return self.size + 3

    def get_child_index(self, name):
        if name == "m_size":
            return self.size
        elif name == "m_capacity":
            return self.size + 1
        elif name == "m_buffer":
            return self.size + 2
        else:
            return int(name.lstrip('[').rstrip(']'))

    def get_child_at_index(self, index):
        if index == self.size:
            return self.valobj.GetChildMemberWithName("m_size")
        elif index == self.size + 1:
            return self.valobj.GetChildMemberWithName("m_capacity")
        elif index == self.size + 2:
            return self.buffer
        elif index < self.size:
            offset = index * self.data_size
            child = self.buffer.CreateChildAtOffset('[' + str(index) + ']', offset, self.data_type)
            return child
        else:
            return None

    def update(self):
        self.buffer = self.valobj.GetChildMemberWithName('m_buffer')
        self.size = self.valobj.GetChildMemberWithName('m_size').GetValueAsUnsigned(0)
        self.capacity = self.valobj.GetChildMemberWithName('m_capacity').GetValueAsUnsigned(0)
        self.data_type = self.buffer.GetType().GetPointeeType()
        self.data_size = self.data_type.GetByteSize()

    def has_children(self):
        return True


class WTFHashMapProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        impl_ptr = self.valobj.GetChildMemberWithName('m_impl')
        self._hash_table_provider = WTFHashTableProvider(impl_ptr, dict)

    def tableSize(self):
        return self._hash_table_provider.tableSize()

    def keyCount(self):
        return self._hash_table_provider.keyCount()


class WTFHashSetProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        impl_ptr = self.valobj.GetChildMemberWithName('m_impl')
        self._hash_table_provider = WTFHashTableProvider(impl_ptr, dict)

    def tableSize(self):
        return self._hash_table_provider.tableSize()

    def keyCount(self):
        return self._hash_table_provider.keyCount()


class WTFHashTableProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj
        self.update()

    def metadataWithIndex(self, index):
        table_pointer = self.valobj.GetChildMemberWithName('m_tableForLLDB')
        metadata_pointer = table_pointer.GetValueAsUnsigned() + 4 * index
        byte_order = self.valobj.GetTarget().GetByteOrder()
        address_byte_size = self.valobj.GetTarget().GetAddressByteSize()
        pointer_data = lldb.SBData.CreateDataFromUInt64Array(byte_order, address_byte_size, [metadata_pointer])
        return self.valobj.CreateValueFromData('[0]', pointer_data, table_pointer.GetType()).Dereference().GetValueAsUnsigned()

    def tableSize(self):
        return self.metadataWithIndex(-1)

    def keyCount(self):
        return self.metadataWithIndex(-3)

    # Synthetic children provider methods.
    def num_children(self):
        return self.tableSize() + 1

    def get_child_index(self, name):
        if name == "m_table":
            return self.tableSize()
        else:
            return int(name.lstrip('[').rstrip(']'))

    def get_child_at_index(self, index):
        if index == self.tableSize():
            return self.valobj.GetChildMemberWithName('m_table')
        elif index < self.tableSize():
            table = self.valobj.GetChildMemberWithName('m_table')
            return table.CreateChildAtOffset('[' + str(index) + ']', index * self.data_size, self.data_type)
        else:
            return None

    def update(self):
        self.data_type = self.valobj.GetType().GetTemplateArgumentType(1)
        self.data_size = self.data_type.GetByteSize()

    def has_children(self):
        return True


class WTFMediaTimeProvider:
    def __init__(self, valobj, internal_dict):
        self.valobj = valobj

    def timeValue(self):
        return self.valobj.GetChildMemberWithName('m_timeValue').GetValueAsSigned(0)

    def timeValueAsDouble(self):
        error = lldb.SBError()
        return self.valobj.GetChildMemberWithName('m_timeValueAsDouble').GetData().GetDouble(error, 0)

    def timeScale(self):
        return self.valobj.GetChildMemberWithName('m_timeScale').GetValueAsSigned(0)

    def isInvalid(self):
        return not self.valobj.GetChildMemberWithName('m_timeFlags').GetValueAsSigned(0) & (1 << 0)

    def isPositiveInfinity(self):
        return self.valobj.GetChildMemberWithName('m_timeFlags').GetValueAsSigned(0) & (1 << 2)

    def isNegativeInfinity(self):
        return self.valobj.GetChildMemberWithName('m_timeFlags').GetValueAsSigned(0) & (1 << 3)

    def isIndefinite(self):
        return self.valobj.GetChildMemberWithName('m_timeFlags').GetValueAsSigned(0) & (1 << 4)

    def hasDoubleValue(self):
        return self.valobj.GetChildMemberWithName('m_timeFlags').GetValueAsSigned(0) & (1 << 5)
