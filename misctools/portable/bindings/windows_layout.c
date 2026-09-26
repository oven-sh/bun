// Written by misctools/portable/bindings/layout.ts from the bindings of bun. Do not edit.
//
// Prints, as JSON, what the headers of the Windows SDK and of libuv say about the structures and the
// constants of bun's bindings: sizes, alignments, offsets, values. verify.ts compiles and runs it:
//   clang -I <libuv>/include -o windows_layout.exe windows_layout.c
// Each fact is behind an #ifndef SKIP_..: a name that the headers do not have is left out by
// defining its macro, which verify.ts does from the messages of the compiler.
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winternl.h>
#endif
#include <stddef.h>
#include <stdio.h>
#include <uv.h>

static int first;
static void comma(void) {
  if (!first) printf(",");
  first = 0;
}
#define TYPE_BEGIN(name) comma(); printf("\n\"" #name "\":{\"size\":%zu,\"align\":%zu,\"fields\":{", sizeof(name), _Alignof(name)); first = 1;
#define FIELD(type, name) comma(); printf("\"" #name "\":{\"offset\":%zu,\"size\":%zu}", offsetof(type, name), sizeof(((type *)0)->name));
#define TYPE_END printf("}}"); first = 0;
#define CONSTANT_SIGNED(name) comma(); printf("\n\"" #name "\":\"%lld\"", (long long)(name));
#define CONSTANT_UNSIGNED(name) comma(); printf("\n\"" #name "\":\"%llu\"", (unsigned long long)(name));

int main(void) {
  printf("{\"source\":\"headers\",\"pointer_bits\":%zu,\"types\":{", sizeof(void *) * 8);
  first = 1;
#ifndef SKIP_TYPE_COORD
  TYPE_BEGIN(COORD)
#ifndef SKIP_FIELD_COORD_X
  FIELD(COORD, X)
#endif
#ifndef SKIP_FIELD_COORD_Y
  FIELD(COORD, Y)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_SMALL_RECT
  TYPE_BEGIN(SMALL_RECT)
#ifndef SKIP_FIELD_SMALL_RECT_Left
  FIELD(SMALL_RECT, Left)
#endif
#ifndef SKIP_FIELD_SMALL_RECT_Top
  FIELD(SMALL_RECT, Top)
#endif
#ifndef SKIP_FIELD_SMALL_RECT_Right
  FIELD(SMALL_RECT, Right)
#endif
#ifndef SKIP_FIELD_SMALL_RECT_Bottom
  FIELD(SMALL_RECT, Bottom)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_CONSOLE_SCREEN_BUFFER_INFO
  TYPE_BEGIN(CONSOLE_SCREEN_BUFFER_INFO)
#ifndef SKIP_FIELD_CONSOLE_SCREEN_BUFFER_INFO_dwSize
  FIELD(CONSOLE_SCREEN_BUFFER_INFO, dwSize)
#endif
#ifndef SKIP_FIELD_CONSOLE_SCREEN_BUFFER_INFO_dwCursorPosition
  FIELD(CONSOLE_SCREEN_BUFFER_INFO, dwCursorPosition)
#endif
#ifndef SKIP_FIELD_CONSOLE_SCREEN_BUFFER_INFO_wAttributes
  FIELD(CONSOLE_SCREEN_BUFFER_INFO, wAttributes)
#endif
#ifndef SKIP_FIELD_CONSOLE_SCREEN_BUFFER_INFO_srWindow
  FIELD(CONSOLE_SCREEN_BUFFER_INFO, srWindow)
#endif
#ifndef SKIP_FIELD_CONSOLE_SCREEN_BUFFER_INFO_dwMaximumWindowSize
  FIELD(CONSOLE_SCREEN_BUFFER_INFO, dwMaximumWindowSize)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILETIME
  TYPE_BEGIN(FILETIME)
#ifndef SKIP_FIELD_FILETIME_dwLowDateTime
  FIELD(FILETIME, dwLowDateTime)
#endif
#ifndef SKIP_FIELD_FILETIME_dwHighDateTime
  FIELD(FILETIME, dwHighDateTime)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_OVERLAPPED
  TYPE_BEGIN(OVERLAPPED)
#ifndef SKIP_FIELD_OVERLAPPED_Internal
  FIELD(OVERLAPPED, Internal)
#endif
#ifndef SKIP_FIELD_OVERLAPPED_InternalHigh
  FIELD(OVERLAPPED, InternalHigh)
#endif
#ifndef SKIP_FIELD_OVERLAPPED_Offset
  FIELD(OVERLAPPED, Offset)
#endif
#ifndef SKIP_FIELD_OVERLAPPED_OffsetHigh
  FIELD(OVERLAPPED, OffsetHigh)
#endif
#ifndef SKIP_FIELD_OVERLAPPED_hEvent
  FIELD(OVERLAPPED, hEvent)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_CRITICAL_SECTION
  TYPE_BEGIN(CRITICAL_SECTION)
#ifndef SKIP_FIELD_CRITICAL_SECTION_DebugInfo
  FIELD(CRITICAL_SECTION, DebugInfo)
#endif
#ifndef SKIP_FIELD_CRITICAL_SECTION_LockCount
  FIELD(CRITICAL_SECTION, LockCount)
#endif
#ifndef SKIP_FIELD_CRITICAL_SECTION_RecursionCount
  FIELD(CRITICAL_SECTION, RecursionCount)
#endif
#ifndef SKIP_FIELD_CRITICAL_SECTION_OwningThread
  FIELD(CRITICAL_SECTION, OwningThread)
#endif
#ifndef SKIP_FIELD_CRITICAL_SECTION_LockSemaphore
  FIELD(CRITICAL_SECTION, LockSemaphore)
#endif
#ifndef SKIP_FIELD_CRITICAL_SECTION_SpinCount
  FIELD(CRITICAL_SECTION, SpinCount)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_WIN32_FIND_DATAW
  TYPE_BEGIN(WIN32_FIND_DATAW)
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_dwFileAttributes
  FIELD(WIN32_FIND_DATAW, dwFileAttributes)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_ftCreationTime
  FIELD(WIN32_FIND_DATAW, ftCreationTime)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_ftLastAccessTime
  FIELD(WIN32_FIND_DATAW, ftLastAccessTime)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_ftLastWriteTime
  FIELD(WIN32_FIND_DATAW, ftLastWriteTime)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_nFileSizeHigh
  FIELD(WIN32_FIND_DATAW, nFileSizeHigh)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_nFileSizeLow
  FIELD(WIN32_FIND_DATAW, nFileSizeLow)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_dwReserved0
  FIELD(WIN32_FIND_DATAW, dwReserved0)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_dwReserved1
  FIELD(WIN32_FIND_DATAW, dwReserved1)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_cFileName
  FIELD(WIN32_FIND_DATAW, cFileName)
#endif
#ifndef SKIP_FIELD_WIN32_FIND_DATAW_cAlternateFileName
  FIELD(WIN32_FIND_DATAW, cAlternateFileName)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_KEY_EVENT_RECORD_uChar
  TYPE_BEGIN(KEY_EVENT_RECORD_uChar)
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_uChar_UnicodeChar
  FIELD(KEY_EVENT_RECORD_uChar, UnicodeChar)
#endif
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_uChar_AsciiChar
  FIELD(KEY_EVENT_RECORD_uChar, AsciiChar)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_KEY_EVENT_RECORD
  TYPE_BEGIN(KEY_EVENT_RECORD)
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_bKeyDown
  FIELD(KEY_EVENT_RECORD, bKeyDown)
#endif
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_wRepeatCount
  FIELD(KEY_EVENT_RECORD, wRepeatCount)
#endif
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_wVirtualKeyCode
  FIELD(KEY_EVENT_RECORD, wVirtualKeyCode)
#endif
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_wVirtualScanCode
  FIELD(KEY_EVENT_RECORD, wVirtualScanCode)
#endif
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_uChar
  FIELD(KEY_EVENT_RECORD, uChar)
#endif
#ifndef SKIP_FIELD_KEY_EVENT_RECORD_dwControlKeyState
  FIELD(KEY_EVENT_RECORD, dwControlKeyState)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_MOUSE_EVENT_RECORD
  TYPE_BEGIN(MOUSE_EVENT_RECORD)
#ifndef SKIP_FIELD_MOUSE_EVENT_RECORD_dwMousePosition
  FIELD(MOUSE_EVENT_RECORD, dwMousePosition)
#endif
#ifndef SKIP_FIELD_MOUSE_EVENT_RECORD_dwButtonState
  FIELD(MOUSE_EVENT_RECORD, dwButtonState)
#endif
#ifndef SKIP_FIELD_MOUSE_EVENT_RECORD_dwControlKeyState
  FIELD(MOUSE_EVENT_RECORD, dwControlKeyState)
#endif
#ifndef SKIP_FIELD_MOUSE_EVENT_RECORD_dwEventFlags
  FIELD(MOUSE_EVENT_RECORD, dwEventFlags)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_WINDOW_BUFFER_SIZE_EVENT
  TYPE_BEGIN(WINDOW_BUFFER_SIZE_EVENT)
#ifndef SKIP_FIELD_WINDOW_BUFFER_SIZE_EVENT_dwSize
  FIELD(WINDOW_BUFFER_SIZE_EVENT, dwSize)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_MENU_EVENT_RECORD
  TYPE_BEGIN(MENU_EVENT_RECORD)
#ifndef SKIP_FIELD_MENU_EVENT_RECORD_dwCommandId
  FIELD(MENU_EVENT_RECORD, dwCommandId)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FOCUS_EVENT_RECORD
  TYPE_BEGIN(FOCUS_EVENT_RECORD)
#ifndef SKIP_FIELD_FOCUS_EVENT_RECORD_bSetFocus
  FIELD(FOCUS_EVENT_RECORD, bSetFocus)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_INPUT_RECORD_Event
  TYPE_BEGIN(INPUT_RECORD_Event)
#ifndef SKIP_FIELD_INPUT_RECORD_Event_KeyEvent
  FIELD(INPUT_RECORD_Event, KeyEvent)
#endif
#ifndef SKIP_FIELD_INPUT_RECORD_Event_MouseEvent
  FIELD(INPUT_RECORD_Event, MouseEvent)
#endif
#ifndef SKIP_FIELD_INPUT_RECORD_Event_WindowBufferSizeEvent
  FIELD(INPUT_RECORD_Event, WindowBufferSizeEvent)
#endif
#ifndef SKIP_FIELD_INPUT_RECORD_Event_MenuEvent
  FIELD(INPUT_RECORD_Event, MenuEvent)
#endif
#ifndef SKIP_FIELD_INPUT_RECORD_Event_FocusEvent
  FIELD(INPUT_RECORD_Event, FocusEvent)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_INPUT_RECORD
  TYPE_BEGIN(INPUT_RECORD)
#ifndef SKIP_FIELD_INPUT_RECORD_EventType
  FIELD(INPUT_RECORD, EventType)
#endif
#ifndef SKIP_FIELD_INPUT_RECORD_Event
  FIELD(INPUT_RECORD, Event)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_SECURITY_ATTRIBUTES
  TYPE_BEGIN(SECURITY_ATTRIBUTES)
#ifndef SKIP_FIELD_SECURITY_ATTRIBUTES_nLength
  FIELD(SECURITY_ATTRIBUTES, nLength)
#endif
#ifndef SKIP_FIELD_SECURITY_ATTRIBUTES_lpSecurityDescriptor
  FIELD(SECURITY_ATTRIBUTES, lpSecurityDescriptor)
#endif
#ifndef SKIP_FIELD_SECURITY_ATTRIBUTES_bInheritHandle
  FIELD(SECURITY_ATTRIBUTES, bInheritHandle)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_BY_HANDLE_FILE_INFORMATION
  TYPE_BEGIN(BY_HANDLE_FILE_INFORMATION)
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_dwFileAttributes
  FIELD(BY_HANDLE_FILE_INFORMATION, dwFileAttributes)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_ftCreationTime
  FIELD(BY_HANDLE_FILE_INFORMATION, ftCreationTime)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_ftLastAccessTime
  FIELD(BY_HANDLE_FILE_INFORMATION, ftLastAccessTime)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_ftLastWriteTime
  FIELD(BY_HANDLE_FILE_INFORMATION, ftLastWriteTime)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_dwVolumeSerialNumber
  FIELD(BY_HANDLE_FILE_INFORMATION, dwVolumeSerialNumber)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_nFileSizeHigh
  FIELD(BY_HANDLE_FILE_INFORMATION, nFileSizeHigh)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_nFileSizeLow
  FIELD(BY_HANDLE_FILE_INFORMATION, nFileSizeLow)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_nNumberOfLinks
  FIELD(BY_HANDLE_FILE_INFORMATION, nNumberOfLinks)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_nFileIndexHigh
  FIELD(BY_HANDLE_FILE_INFORMATION, nFileIndexHigh)
#endif
#ifndef SKIP_FIELD_BY_HANDLE_FILE_INFORMATION_nFileIndexLow
  FIELD(BY_HANDLE_FILE_INFORMATION, nFileIndexLow)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_WIN32_FILE_ATTRIBUTE_DATA
  TYPE_BEGIN(WIN32_FILE_ATTRIBUTE_DATA)
#ifndef SKIP_FIELD_WIN32_FILE_ATTRIBUTE_DATA_dwFileAttributes
  FIELD(WIN32_FILE_ATTRIBUTE_DATA, dwFileAttributes)
#endif
#ifndef SKIP_FIELD_WIN32_FILE_ATTRIBUTE_DATA_ftCreationTime
  FIELD(WIN32_FILE_ATTRIBUTE_DATA, ftCreationTime)
#endif
#ifndef SKIP_FIELD_WIN32_FILE_ATTRIBUTE_DATA_ftLastAccessTime
  FIELD(WIN32_FILE_ATTRIBUTE_DATA, ftLastAccessTime)
#endif
#ifndef SKIP_FIELD_WIN32_FILE_ATTRIBUTE_DATA_ftLastWriteTime
  FIELD(WIN32_FILE_ATTRIBUTE_DATA, ftLastWriteTime)
#endif
#ifndef SKIP_FIELD_WIN32_FILE_ATTRIBUTE_DATA_nFileSizeHigh
  FIELD(WIN32_FILE_ATTRIBUTE_DATA, nFileSizeHigh)
#endif
#ifndef SKIP_FIELD_WIN32_FILE_ATTRIBUTE_DATA_nFileSizeLow
  FIELD(WIN32_FILE_ATTRIBUTE_DATA, nFileSizeLow)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_UNICODE_STRING
  TYPE_BEGIN(UNICODE_STRING)
#ifndef SKIP_FIELD_UNICODE_STRING_Length
  FIELD(UNICODE_STRING, Length)
#endif
#ifndef SKIP_FIELD_UNICODE_STRING_MaximumLength
  FIELD(UNICODE_STRING, MaximumLength)
#endif
#ifndef SKIP_FIELD_UNICODE_STRING_Buffer
  FIELD(UNICODE_STRING, Buffer)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_OBJECT_ATTRIBUTES
  TYPE_BEGIN(OBJECT_ATTRIBUTES)
#ifndef SKIP_FIELD_OBJECT_ATTRIBUTES_Length
  FIELD(OBJECT_ATTRIBUTES, Length)
#endif
#ifndef SKIP_FIELD_OBJECT_ATTRIBUTES_RootDirectory
  FIELD(OBJECT_ATTRIBUTES, RootDirectory)
#endif
#ifndef SKIP_FIELD_OBJECT_ATTRIBUTES_ObjectName
  FIELD(OBJECT_ATTRIBUTES, ObjectName)
#endif
#ifndef SKIP_FIELD_OBJECT_ATTRIBUTES_Attributes
  FIELD(OBJECT_ATTRIBUTES, Attributes)
#endif
#ifndef SKIP_FIELD_OBJECT_ATTRIBUTES_SecurityDescriptor
  FIELD(OBJECT_ATTRIBUTES, SecurityDescriptor)
#endif
#ifndef SKIP_FIELD_OBJECT_ATTRIBUTES_SecurityQualityOfService
  FIELD(OBJECT_ATTRIBUTES, SecurityQualityOfService)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_IO_STATUS_BLOCK
  TYPE_BEGIN(IO_STATUS_BLOCK)
#ifndef SKIP_FIELD_IO_STATUS_BLOCK_Status
  FIELD(IO_STATUS_BLOCK, Status)
#endif
#ifndef SKIP_FIELD_IO_STATUS_BLOCK_Information
  FIELD(IO_STATUS_BLOCK, Information)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_BASIC_INFORMATION
  TYPE_BEGIN(FILE_BASIC_INFORMATION)
#ifndef SKIP_FIELD_FILE_BASIC_INFORMATION_CreationTime
  FIELD(FILE_BASIC_INFORMATION, CreationTime)
#endif
#ifndef SKIP_FIELD_FILE_BASIC_INFORMATION_LastAccessTime
  FIELD(FILE_BASIC_INFORMATION, LastAccessTime)
#endif
#ifndef SKIP_FIELD_FILE_BASIC_INFORMATION_LastWriteTime
  FIELD(FILE_BASIC_INFORMATION, LastWriteTime)
#endif
#ifndef SKIP_FIELD_FILE_BASIC_INFORMATION_ChangeTime
  FIELD(FILE_BASIC_INFORMATION, ChangeTime)
#endif
#ifndef SKIP_FIELD_FILE_BASIC_INFORMATION_FileAttributes
  FIELD(FILE_BASIC_INFORMATION, FileAttributes)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_DIRECTORY_INFORMATION
  TYPE_BEGIN(FILE_DIRECTORY_INFORMATION)
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_NextEntryOffset
  FIELD(FILE_DIRECTORY_INFORMATION, NextEntryOffset)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_FileIndex
  FIELD(FILE_DIRECTORY_INFORMATION, FileIndex)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_CreationTime
  FIELD(FILE_DIRECTORY_INFORMATION, CreationTime)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_LastAccessTime
  FIELD(FILE_DIRECTORY_INFORMATION, LastAccessTime)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_LastWriteTime
  FIELD(FILE_DIRECTORY_INFORMATION, LastWriteTime)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_ChangeTime
  FIELD(FILE_DIRECTORY_INFORMATION, ChangeTime)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_EndOfFile
  FIELD(FILE_DIRECTORY_INFORMATION, EndOfFile)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_AllocationSize
  FIELD(FILE_DIRECTORY_INFORMATION, AllocationSize)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_FileAttributes
  FIELD(FILE_DIRECTORY_INFORMATION, FileAttributes)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_FileNameLength
  FIELD(FILE_DIRECTORY_INFORMATION, FileNameLength)
#endif
#ifndef SKIP_FIELD_FILE_DIRECTORY_INFORMATION_FileName
  FIELD(FILE_DIRECTORY_INFORMATION, FileName)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_STANDARD_INFORMATION
  TYPE_BEGIN(FILE_STANDARD_INFORMATION)
#ifndef SKIP_FIELD_FILE_STANDARD_INFORMATION_AllocationSize
  FIELD(FILE_STANDARD_INFORMATION, AllocationSize)
#endif
#ifndef SKIP_FIELD_FILE_STANDARD_INFORMATION_EndOfFile
  FIELD(FILE_STANDARD_INFORMATION, EndOfFile)
#endif
#ifndef SKIP_FIELD_FILE_STANDARD_INFORMATION_NumberOfLinks
  FIELD(FILE_STANDARD_INFORMATION, NumberOfLinks)
#endif
#ifndef SKIP_FIELD_FILE_STANDARD_INFORMATION_DeletePending
  FIELD(FILE_STANDARD_INFORMATION, DeletePending)
#endif
#ifndef SKIP_FIELD_FILE_STANDARD_INFORMATION_Directory
  FIELD(FILE_STANDARD_INFORMATION, Directory)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_INTERNAL_INFORMATION
  TYPE_BEGIN(FILE_INTERNAL_INFORMATION)
#ifndef SKIP_FIELD_FILE_INTERNAL_INFORMATION_IndexNumber
  FIELD(FILE_INTERNAL_INFORMATION, IndexNumber)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_ALL_INFORMATION
  TYPE_BEGIN(FILE_ALL_INFORMATION)
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_BasicInformation
  FIELD(FILE_ALL_INFORMATION, BasicInformation)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_StandardInformation
  FIELD(FILE_ALL_INFORMATION, StandardInformation)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_InternalInformation
  FIELD(FILE_ALL_INFORMATION, InternalInformation)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_EaSize
  FIELD(FILE_ALL_INFORMATION, EaSize)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_AccessFlags
  FIELD(FILE_ALL_INFORMATION, AccessFlags)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_CurrentByteOffset
  FIELD(FILE_ALL_INFORMATION, CurrentByteOffset)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_Mode
  FIELD(FILE_ALL_INFORMATION, Mode)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_AlignmentRequirement
  FIELD(FILE_ALL_INFORMATION, AlignmentRequirement)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_FileNameLength
  FIELD(FILE_ALL_INFORMATION, FileNameLength)
#endif
#ifndef SKIP_FIELD_FILE_ALL_INFORMATION_FileName
  FIELD(FILE_ALL_INFORMATION, FileName)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_FS_DEVICE_INFORMATION
  TYPE_BEGIN(FILE_FS_DEVICE_INFORMATION)
#ifndef SKIP_FIELD_FILE_FS_DEVICE_INFORMATION_DeviceType
  FIELD(FILE_FS_DEVICE_INFORMATION, DeviceType)
#endif
#ifndef SKIP_FIELD_FILE_FS_DEVICE_INFORMATION_Characteristics
  FIELD(FILE_FS_DEVICE_INFORMATION, Characteristics)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_FS_VOLUME_INFORMATION
  TYPE_BEGIN(FILE_FS_VOLUME_INFORMATION)
#ifndef SKIP_FIELD_FILE_FS_VOLUME_INFORMATION_VolumeCreationTime
  FIELD(FILE_FS_VOLUME_INFORMATION, VolumeCreationTime)
#endif
#ifndef SKIP_FIELD_FILE_FS_VOLUME_INFORMATION_VolumeSerialNumber
  FIELD(FILE_FS_VOLUME_INFORMATION, VolumeSerialNumber)
#endif
#ifndef SKIP_FIELD_FILE_FS_VOLUME_INFORMATION_VolumeLabelLength
  FIELD(FILE_FS_VOLUME_INFORMATION, VolumeLabelLength)
#endif
#ifndef SKIP_FIELD_FILE_FS_VOLUME_INFORMATION_SupportsObjects
  FIELD(FILE_FS_VOLUME_INFORMATION, SupportsObjects)
#endif
#ifndef SKIP_FIELD_FILE_FS_VOLUME_INFORMATION_VolumeLabel
  FIELD(FILE_FS_VOLUME_INFORMATION, VolumeLabel)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_END_OF_FILE_INFORMATION
  TYPE_BEGIN(FILE_END_OF_FILE_INFORMATION)
#ifndef SKIP_FIELD_FILE_END_OF_FILE_INFORMATION_EndOfFile
  FIELD(FILE_END_OF_FILE_INFORMATION, EndOfFile)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_DISPOSITION_INFORMATION
  TYPE_BEGIN(FILE_DISPOSITION_INFORMATION)
#ifndef SKIP_FIELD_FILE_DISPOSITION_INFORMATION_DeleteFile
  FIELD(FILE_DISPOSITION_INFORMATION, DeleteFile)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_DISPOSITION_INFORMATION_EX
  TYPE_BEGIN(FILE_DISPOSITION_INFORMATION_EX)
#ifndef SKIP_FIELD_FILE_DISPOSITION_INFORMATION_EX_Flags
  FIELD(FILE_DISPOSITION_INFORMATION_EX, Flags)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_RENAME_INFORMATION_EX
  TYPE_BEGIN(FILE_RENAME_INFORMATION_EX)
#ifndef SKIP_FIELD_FILE_RENAME_INFORMATION_EX_Flags
  FIELD(FILE_RENAME_INFORMATION_EX, Flags)
#endif
#ifndef SKIP_FIELD_FILE_RENAME_INFORMATION_EX_RootDirectory
  FIELD(FILE_RENAME_INFORMATION_EX, RootDirectory)
#endif
#ifndef SKIP_FIELD_FILE_RENAME_INFORMATION_EX_FileNameLength
  FIELD(FILE_RENAME_INFORMATION_EX, FileNameLength)
#endif
#ifndef SKIP_FIELD_FILE_RENAME_INFORMATION_EX_FileName
  FIELD(FILE_RENAME_INFORMATION_EX, FileName)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_RUNTIME_FUNCTION
  TYPE_BEGIN(RUNTIME_FUNCTION)
#ifndef SKIP_FIELD_RUNTIME_FUNCTION_BeginAddress
  FIELD(RUNTIME_FUNCTION, BeginAddress)
#endif
#ifndef SKIP_FIELD_RUNTIME_FUNCTION_EndAddress
  FIELD(RUNTIME_FUNCTION, EndAddress)
#endif
#ifndef SKIP_FIELD_RUNTIME_FUNCTION_UnwindData
  FIELD(RUNTIME_FUNCTION, UnwindData)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_M128A
  TYPE_BEGIN(M128A)
#ifndef SKIP_FIELD_M128A_Low
  FIELD(M128A, Low)
#endif
#ifndef SKIP_FIELD_M128A_High
  FIELD(M128A, High)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_MEMORY_BASIC_INFORMATION
  TYPE_BEGIN(MEMORY_BASIC_INFORMATION)
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_BaseAddress
  FIELD(MEMORY_BASIC_INFORMATION, BaseAddress)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_AllocationBase
  FIELD(MEMORY_BASIC_INFORMATION, AllocationBase)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_AllocationProtect
  FIELD(MEMORY_BASIC_INFORMATION, AllocationProtect)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_PartitionId
  FIELD(MEMORY_BASIC_INFORMATION, PartitionId)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_RegionSize
  FIELD(MEMORY_BASIC_INFORMATION, RegionSize)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_State
  FIELD(MEMORY_BASIC_INFORMATION, State)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_Protect
  FIELD(MEMORY_BASIC_INFORMATION, Protect)
#endif
#ifndef SKIP_FIELD_MEMORY_BASIC_INFORMATION_Type
  FIELD(MEMORY_BASIC_INFORMATION, Type)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_addrinfo
  TYPE_BEGIN(addrinfo)
#ifndef SKIP_FIELD_addrinfo_ai_flags
  FIELD(addrinfo, ai_flags)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_family
  FIELD(addrinfo, ai_family)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_socktype
  FIELD(addrinfo, ai_socktype)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_protocol
  FIELD(addrinfo, ai_protocol)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_addrlen
  FIELD(addrinfo, ai_addrlen)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_canonname
  FIELD(addrinfo, ai_canonname)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_addr
  FIELD(addrinfo, ai_addr)
#endif
#ifndef SKIP_FIELD_addrinfo_ai_next
  FIELD(addrinfo, ai_next)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_sockaddr_storage
  TYPE_BEGIN(sockaddr_storage)
#ifndef SKIP_FIELD_sockaddr_storage_ss_family
  FIELD(sockaddr_storage, ss_family)
#endif
#ifndef SKIP_FIELD_sockaddr_storage___ss_pad1
  FIELD(sockaddr_storage, __ss_pad1)
#endif
#ifndef SKIP_FIELD_sockaddr_storage___ss_align
  FIELD(sockaddr_storage, __ss_align)
#endif
#ifndef SKIP_FIELD_sockaddr_storage___ss_pad2
  FIELD(sockaddr_storage, __ss_pad2)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_sockaddr
  TYPE_BEGIN(sockaddr)
#ifndef SKIP_FIELD_sockaddr_sa_family
  FIELD(sockaddr, sa_family)
#endif
#ifndef SKIP_FIELD_sockaddr_sa_data
  FIELD(sockaddr, sa_data)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_sockaddr_in
  TYPE_BEGIN(sockaddr_in)
#ifndef SKIP_FIELD_sockaddr_in_sin_family
  FIELD(sockaddr_in, sin_family)
#endif
#ifndef SKIP_FIELD_sockaddr_in_sin_port
  FIELD(sockaddr_in, sin_port)
#endif
#ifndef SKIP_FIELD_sockaddr_in_sin_addr
  FIELD(sockaddr_in, sin_addr)
#endif
#ifndef SKIP_FIELD_sockaddr_in_sin_zero
  FIELD(sockaddr_in, sin_zero)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_in_addr
  TYPE_BEGIN(in_addr)
#ifndef SKIP_FIELD_in_addr_s_addr
  FIELD(in_addr, s_addr)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_sockaddr_in6
  TYPE_BEGIN(sockaddr_in6)
#ifndef SKIP_FIELD_sockaddr_in6_sin6_family
  FIELD(sockaddr_in6, sin6_family)
#endif
#ifndef SKIP_FIELD_sockaddr_in6_sin6_port
  FIELD(sockaddr_in6, sin6_port)
#endif
#ifndef SKIP_FIELD_sockaddr_in6_sin6_flowinfo
  FIELD(sockaddr_in6, sin6_flowinfo)
#endif
#ifndef SKIP_FIELD_sockaddr_in6_sin6_addr
  FIELD(sockaddr_in6, sin6_addr)
#endif
#ifndef SKIP_FIELD_sockaddr_in6_sin6_scope_id
  FIELD(sockaddr_in6, sin6_scope_id)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_in6_addr
  TYPE_BEGIN(in6_addr)
#ifndef SKIP_FIELD_in6_addr_s6_addr
  FIELD(in6_addr, s6_addr)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_WSAPOLLFD
  TYPE_BEGIN(WSAPOLLFD)
#ifndef SKIP_FIELD_WSAPOLLFD_fd
  FIELD(WSAPOLLFD, fd)
#endif
#ifndef SKIP_FIELD_WSAPOLLFD_events
  FIELD(WSAPOLLFD, events)
#endif
#ifndef SKIP_FIELD_WSAPOLLFD_revents
  FIELD(WSAPOLLFD, revents)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_SYSTEM_INFO
  TYPE_BEGIN(SYSTEM_INFO)
#ifndef SKIP_FIELD_SYSTEM_INFO_wProcessorArchitecture
  FIELD(SYSTEM_INFO, wProcessorArchitecture)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_wReserved
  FIELD(SYSTEM_INFO, wReserved)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_dwPageSize
  FIELD(SYSTEM_INFO, dwPageSize)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_lpMinimumApplicationAddress
  FIELD(SYSTEM_INFO, lpMinimumApplicationAddress)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_lpMaximumApplicationAddress
  FIELD(SYSTEM_INFO, lpMaximumApplicationAddress)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_dwActiveProcessorMask
  FIELD(SYSTEM_INFO, dwActiveProcessorMask)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_dwNumberOfProcessors
  FIELD(SYSTEM_INFO, dwNumberOfProcessors)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_dwProcessorType
  FIELD(SYSTEM_INFO, dwProcessorType)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_dwAllocationGranularity
  FIELD(SYSTEM_INFO, dwAllocationGranularity)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_wProcessorLevel
  FIELD(SYSTEM_INFO, wProcessorLevel)
#endif
#ifndef SKIP_FIELD_SYSTEM_INFO_wProcessorRevision
  FIELD(SYSTEM_INFO, wProcessorRevision)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_PROCESS_BASIC_INFORMATION
  TYPE_BEGIN(PROCESS_BASIC_INFORMATION)
#ifndef SKIP_FIELD_PROCESS_BASIC_INFORMATION_ExitStatus
  FIELD(PROCESS_BASIC_INFORMATION, ExitStatus)
#endif
#ifndef SKIP_FIELD_PROCESS_BASIC_INFORMATION_PebBaseAddress
  FIELD(PROCESS_BASIC_INFORMATION, PebBaseAddress)
#endif
#ifndef SKIP_FIELD_PROCESS_BASIC_INFORMATION_AffinityMask
  FIELD(PROCESS_BASIC_INFORMATION, AffinityMask)
#endif
#ifndef SKIP_FIELD_PROCESS_BASIC_INFORMATION_BasePriority
  FIELD(PROCESS_BASIC_INFORMATION, BasePriority)
#endif
#ifndef SKIP_FIELD_PROCESS_BASIC_INFORMATION_UniqueProcessId
  FIELD(PROCESS_BASIC_INFORMATION, UniqueProcessId)
#endif
#ifndef SKIP_FIELD_PROCESS_BASIC_INFORMATION_InheritedFromUniqueProcessId
  FIELD(PROCESS_BASIC_INFORMATION, InheritedFromUniqueProcessId)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_JOBOBJECT_ASSOCIATE_COMPLETION_PORT
  TYPE_BEGIN(JOBOBJECT_ASSOCIATE_COMPLETION_PORT)
#ifndef SKIP_FIELD_JOBOBJECT_ASSOCIATE_COMPLETION_PORT_CompletionKey
  FIELD(JOBOBJECT_ASSOCIATE_COMPLETION_PORT, CompletionKey)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_ASSOCIATE_COMPLETION_PORT_CompletionPort
  FIELD(JOBOBJECT_ASSOCIATE_COMPLETION_PORT, CompletionPort)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_JOBOBJECT_BASIC_LIMIT_INFORMATION
  TYPE_BEGIN(JOBOBJECT_BASIC_LIMIT_INFORMATION)
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_PerProcessUserTimeLimit
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, PerProcessUserTimeLimit)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_PerJobUserTimeLimit
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, PerJobUserTimeLimit)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_LimitFlags
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, LimitFlags)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_MinimumWorkingSetSize
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, MinimumWorkingSetSize)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_MaximumWorkingSetSize
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, MaximumWorkingSetSize)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_ActiveProcessLimit
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, ActiveProcessLimit)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_Affinity
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, Affinity)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_PriorityClass
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, PriorityClass)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_BASIC_LIMIT_INFORMATION_SchedulingClass
  FIELD(JOBOBJECT_BASIC_LIMIT_INFORMATION, SchedulingClass)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_IO_COUNTERS
  TYPE_BEGIN(IO_COUNTERS)
#ifndef SKIP_FIELD_IO_COUNTERS_ReadOperationCount
  FIELD(IO_COUNTERS, ReadOperationCount)
#endif
#ifndef SKIP_FIELD_IO_COUNTERS_WriteOperationCount
  FIELD(IO_COUNTERS, WriteOperationCount)
#endif
#ifndef SKIP_FIELD_IO_COUNTERS_OtherOperationCount
  FIELD(IO_COUNTERS, OtherOperationCount)
#endif
#ifndef SKIP_FIELD_IO_COUNTERS_ReadTransferCount
  FIELD(IO_COUNTERS, ReadTransferCount)
#endif
#ifndef SKIP_FIELD_IO_COUNTERS_WriteTransferCount
  FIELD(IO_COUNTERS, WriteTransferCount)
#endif
#ifndef SKIP_FIELD_IO_COUNTERS_OtherTransferCount
  FIELD(IO_COUNTERS, OtherTransferCount)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  TYPE_BEGIN(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
#ifndef SKIP_FIELD_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_BasicLimitInformation
  FIELD(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, BasicLimitInformation)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_IoInfo
  FIELD(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, IoInfo)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_ProcessMemoryLimit
  FIELD(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, ProcessMemoryLimit)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_JobMemoryLimit
  FIELD(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobMemoryLimit)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_PeakProcessMemoryUsed
  FIELD(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, PeakProcessMemoryUsed)
#endif
#ifndef SKIP_FIELD_JOBOBJECT_EXTENDED_LIMIT_INFORMATION_PeakJobMemoryUsed
  FIELD(JOBOBJECT_EXTENDED_LIMIT_INFORMATION, PeakJobMemoryUsed)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_STARTUPINFOW
  TYPE_BEGIN(STARTUPINFOW)
#ifndef SKIP_FIELD_STARTUPINFOW_cb
  FIELD(STARTUPINFOW, cb)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_lpReserved
  FIELD(STARTUPINFOW, lpReserved)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_lpDesktop
  FIELD(STARTUPINFOW, lpDesktop)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_lpTitle
  FIELD(STARTUPINFOW, lpTitle)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwX
  FIELD(STARTUPINFOW, dwX)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwY
  FIELD(STARTUPINFOW, dwY)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwXSize
  FIELD(STARTUPINFOW, dwXSize)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwYSize
  FIELD(STARTUPINFOW, dwYSize)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwXCountChars
  FIELD(STARTUPINFOW, dwXCountChars)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwYCountChars
  FIELD(STARTUPINFOW, dwYCountChars)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwFillAttribute
  FIELD(STARTUPINFOW, dwFillAttribute)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_dwFlags
  FIELD(STARTUPINFOW, dwFlags)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_wShowWindow
  FIELD(STARTUPINFOW, wShowWindow)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_cbReserved2
  FIELD(STARTUPINFOW, cbReserved2)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_lpReserved2
  FIELD(STARTUPINFOW, lpReserved2)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_hStdInput
  FIELD(STARTUPINFOW, hStdInput)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_hStdOutput
  FIELD(STARTUPINFOW, hStdOutput)
#endif
#ifndef SKIP_FIELD_STARTUPINFOW_hStdError
  FIELD(STARTUPINFOW, hStdError)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_STARTUPINFOEXW
  TYPE_BEGIN(STARTUPINFOEXW)
#ifndef SKIP_FIELD_STARTUPINFOEXW_StartupInfo
  FIELD(STARTUPINFOEXW, StartupInfo)
#endif
#ifndef SKIP_FIELD_STARTUPINFOEXW_lpAttributeList
  FIELD(STARTUPINFOEXW, lpAttributeList)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_PROCESS_INFORMATION
  TYPE_BEGIN(PROCESS_INFORMATION)
#ifndef SKIP_FIELD_PROCESS_INFORMATION_hProcess
  FIELD(PROCESS_INFORMATION, hProcess)
#endif
#ifndef SKIP_FIELD_PROCESS_INFORMATION_hThread
  FIELD(PROCESS_INFORMATION, hThread)
#endif
#ifndef SKIP_FIELD_PROCESS_INFORMATION_dwProcessId
  FIELD(PROCESS_INFORMATION, dwProcessId)
#endif
#ifndef SKIP_FIELD_PROCESS_INFORMATION_dwThreadId
  FIELD(PROCESS_INFORMATION, dwThreadId)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_CURDIR
  TYPE_BEGIN(CURDIR)
#ifndef SKIP_FIELD_CURDIR_DosPath
  FIELD(CURDIR, DosPath)
#endif
#ifndef SKIP_FIELD_CURDIR_Handle
  FIELD(CURDIR, Handle)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_RTL_USER_PROCESS_PARAMETERS
  TYPE_BEGIN(RTL_USER_PROCESS_PARAMETERS)
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS__reserved1
  FIELD(RTL_USER_PROCESS_PARAMETERS, _reserved1)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS__reserved2
  FIELD(RTL_USER_PROCESS_PARAMETERS, _reserved2)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_hStdInput
  FIELD(RTL_USER_PROCESS_PARAMETERS, hStdInput)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_hStdOutput
  FIELD(RTL_USER_PROCESS_PARAMETERS, hStdOutput)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_hStdError
  FIELD(RTL_USER_PROCESS_PARAMETERS, hStdError)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_CurrentDirectory
  FIELD(RTL_USER_PROCESS_PARAMETERS, CurrentDirectory)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_DllPath
  FIELD(RTL_USER_PROCESS_PARAMETERS, DllPath)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_ImagePathName
  FIELD(RTL_USER_PROCESS_PARAMETERS, ImagePathName)
#endif
#ifndef SKIP_FIELD_RTL_USER_PROCESS_PARAMETERS_CommandLine
  FIELD(RTL_USER_PROCESS_PARAMETERS, CommandLine)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_PEB
  TYPE_BEGIN(PEB)
#ifndef SKIP_FIELD_PEB__reserved1
  FIELD(PEB, _reserved1)
#endif
#ifndef SKIP_FIELD_PEB_BeingDebugged
  FIELD(PEB, BeingDebugged)
#endif
#ifndef SKIP_FIELD_PEB__reserved2
  FIELD(PEB, _reserved2)
#endif
#ifndef SKIP_FIELD_PEB__reserved3
  FIELD(PEB, _reserved3)
#endif
#ifndef SKIP_FIELD_PEB_Ldr
  FIELD(PEB, Ldr)
#endif
#ifndef SKIP_FIELD_PEB_ProcessParameters
  FIELD(PEB, ProcessParameters)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_TEB
  TYPE_BEGIN(TEB)
#ifndef SKIP_FIELD_TEB__nt_tib
  FIELD(TEB, _nt_tib)
#endif
#ifndef SKIP_FIELD_TEB_EnvironmentPointer
  FIELD(TEB, EnvironmentPointer)
#endif
#ifndef SKIP_FIELD_TEB__client_id
  FIELD(TEB, _client_id)
#endif
#ifndef SKIP_FIELD_TEB_ActiveRpcHandle
  FIELD(TEB, ActiveRpcHandle)
#endif
#ifndef SKIP_FIELD_TEB_ThreadLocalStoragePointer
  FIELD(TEB, ThreadLocalStoragePointer)
#endif
#ifndef SKIP_FIELD_TEB_ProcessEnvironmentBlock
  FIELD(TEB, ProcessEnvironmentBlock)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv__queue
  TYPE_BEGIN(uv__queue)
#ifndef SKIP_FIELD_uv__queue_next
  FIELD(uv__queue, next)
#endif
#ifndef SKIP_FIELD_uv__queue_prev
  FIELD(uv__queue, prev)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv__work
  TYPE_BEGIN(uv__work)
#ifndef SKIP_FIELD_uv__work_work
  FIELD(uv__work, work)
#endif
#ifndef SKIP_FIELD_uv__work_done
  FIELD(uv__work, done)
#endif
#ifndef SKIP_FIELD_uv__work_loop
  FIELD(uv__work, loop)
#endif
#ifndef SKIP_FIELD_uv__work_wq
  FIELD(uv__work, wq)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_buf_t
  TYPE_BEGIN(uv_buf_t)
#ifndef SKIP_FIELD_uv_buf_t_len
  FIELD(uv_buf_t, len)
#endif
#ifndef SKIP_FIELD_uv_buf_t_base
  FIELD(uv_buf_t, base)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_req_u_io
  TYPE_BEGIN(req_u_io)
#ifndef SKIP_FIELD_req_u_io_overlapped
  FIELD(req_u_io, overlapped)
#endif
#ifndef SKIP_FIELD_req_u_io_queued_bytes
  FIELD(req_u_io, queued_bytes)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_req_u_connect
  TYPE_BEGIN(req_u_connect)
#ifndef SKIP_FIELD_req_u_connect_result
  FIELD(req_u_connect, result)
#endif
#ifndef SKIP_FIELD_req_u_connect_pipeHandle
  FIELD(req_u_connect, pipeHandle)
#endif
#ifndef SKIP_FIELD_req_u_connect_duplex_flags
  FIELD(req_u_connect, duplex_flags)
#endif
#ifndef SKIP_FIELD_req_u_connect_name
  FIELD(req_u_connect, name)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_req_u
  TYPE_BEGIN(req_u)
#ifndef SKIP_FIELD_req_u_io
  FIELD(req_u, io)
#endif
#ifndef SKIP_FIELD_req_u_connect
  FIELD(req_u, connect)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_req_t
  TYPE_BEGIN(uv_req_t)
#ifndef SKIP_FIELD_uv_req_t_data
  FIELD(uv_req_t, data)
#endif
#ifndef SKIP_FIELD_uv_req_t_type
  FIELD(uv_req_t, type)
#endif
#ifndef SKIP_FIELD_uv_req_t_reserved
  FIELD(uv_req_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_req_t_u
  FIELD(uv_req_t, u)
#endif
#ifndef SKIP_FIELD_uv_req_t_next_req
  FIELD(uv_req_t, next_req)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_handle_u
  TYPE_BEGIN(handle_u)
#ifndef SKIP_FIELD_handle_u_fd
  FIELD(handle_u, fd)
#endif
#ifndef SKIP_FIELD_handle_u_reserved
  FIELD(handle_u, reserved)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_handle_t
  TYPE_BEGIN(uv_handle_t)
#ifndef SKIP_FIELD_uv_handle_t_data
  FIELD(uv_handle_t, data)
#endif
#ifndef SKIP_FIELD_uv_handle_t_loop
  FIELD(uv_handle_t, loop)
#endif
#ifndef SKIP_FIELD_uv_handle_t_type
  FIELD(uv_handle_t, type)
#endif
#ifndef SKIP_FIELD_uv_handle_t_close_cb
  FIELD(uv_handle_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_handle_t_handle_queue
  FIELD(uv_handle_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_handle_t_u
  FIELD(uv_handle_t, u)
#endif
#ifndef SKIP_FIELD_uv_handle_t_endgame_next
  FIELD(uv_handle_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_handle_t_flags
  FIELD(uv_handle_t, flags)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_loop_t
  TYPE_BEGIN(uv_loop_t)
#ifndef SKIP_FIELD_uv_loop_t_data
  FIELD(uv_loop_t, data)
#endif
#ifndef SKIP_FIELD_uv_loop_t_active_handles
  FIELD(uv_loop_t, active_handles)
#endif
#ifndef SKIP_FIELD_uv_loop_t_handle_queue
  FIELD(uv_loop_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_loop_t_active_reqs
  FIELD(uv_loop_t, active_reqs)
#endif
#ifndef SKIP_FIELD_uv_loop_t_internal_fields
  FIELD(uv_loop_t, internal_fields)
#endif
#ifndef SKIP_FIELD_uv_loop_t_stop_flag
  FIELD(uv_loop_t, stop_flag)
#endif
#ifndef SKIP_FIELD_uv_loop_t_iocp
  FIELD(uv_loop_t, iocp)
#endif
#ifndef SKIP_FIELD_uv_loop_t_time
  FIELD(uv_loop_t, time)
#endif
#ifndef SKIP_FIELD_uv_loop_t_pending_reqs_tail
  FIELD(uv_loop_t, pending_reqs_tail)
#endif
#ifndef SKIP_FIELD_uv_loop_t_endgame_handles
  FIELD(uv_loop_t, endgame_handles)
#endif
#ifndef SKIP_FIELD_uv_loop_t_timer_heap
  FIELD(uv_loop_t, timer_heap)
#endif
#ifndef SKIP_FIELD_uv_loop_t_prepare_handles
  FIELD(uv_loop_t, prepare_handles)
#endif
#ifndef SKIP_FIELD_uv_loop_t_check_handles
  FIELD(uv_loop_t, check_handles)
#endif
#ifndef SKIP_FIELD_uv_loop_t_idle_handles
  FIELD(uv_loop_t, idle_handles)
#endif
#ifndef SKIP_FIELD_uv_loop_t_next_prepare_handle
  FIELD(uv_loop_t, next_prepare_handle)
#endif
#ifndef SKIP_FIELD_uv_loop_t_next_check_handle
  FIELD(uv_loop_t, next_check_handle)
#endif
#ifndef SKIP_FIELD_uv_loop_t_next_idle_handle
  FIELD(uv_loop_t, next_idle_handle)
#endif
#ifndef SKIP_FIELD_uv_loop_t_poll_peer_sockets
  FIELD(uv_loop_t, poll_peer_sockets)
#endif
#ifndef SKIP_FIELD_uv_loop_t_active_tcp_streams
  FIELD(uv_loop_t, active_tcp_streams)
#endif
#ifndef SKIP_FIELD_uv_loop_t_active_udp_streams
  FIELD(uv_loop_t, active_udp_streams)
#endif
#ifndef SKIP_FIELD_uv_loop_t_timer_counter
  FIELD(uv_loop_t, timer_counter)
#endif
#ifndef SKIP_FIELD_uv_loop_t_wq
  FIELD(uv_loop_t, wq)
#endif
#ifndef SKIP_FIELD_uv_loop_t_wq_mutex
  FIELD(uv_loop_t, wq_mutex)
#endif
#ifndef SKIP_FIELD_uv_loop_t_wq_async
  FIELD(uv_loop_t, wq_async)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_read_t
  TYPE_BEGIN(uv_read_t)
#ifndef SKIP_FIELD_uv_read_t_data
  FIELD(uv_read_t, data)
#endif
#ifndef SKIP_FIELD_uv_read_t_type
  FIELD(uv_read_t, type)
#endif
#ifndef SKIP_FIELD_uv_read_t_reserved
  FIELD(uv_read_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_read_t_u
  FIELD(uv_read_t, u)
#endif
#ifndef SKIP_FIELD_uv_read_t_next_req
  FIELD(uv_read_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_read_t_event_handle
  FIELD(uv_read_t, event_handle)
#endif
#ifndef SKIP_FIELD_uv_read_t_wait_handle
  FIELD(uv_read_t, wait_handle)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_shutdown_t
  TYPE_BEGIN(uv_shutdown_t)
#ifndef SKIP_FIELD_uv_shutdown_t_data
  FIELD(uv_shutdown_t, data)
#endif
#ifndef SKIP_FIELD_uv_shutdown_t_type
  FIELD(uv_shutdown_t, type)
#endif
#ifndef SKIP_FIELD_uv_shutdown_t_reserved
  FIELD(uv_shutdown_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_shutdown_t_u
  FIELD(uv_shutdown_t, u)
#endif
#ifndef SKIP_FIELD_uv_shutdown_t_next_req
  FIELD(uv_shutdown_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_shutdown_t_handle
  FIELD(uv_shutdown_t, handle)
#endif
#ifndef SKIP_FIELD_uv_shutdown_t_cb
  FIELD(uv_shutdown_t, cb)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_stream_t
  TYPE_BEGIN(uv_stream_t)
#ifndef SKIP_FIELD_uv_stream_t_data
  FIELD(uv_stream_t, data)
#endif
#ifndef SKIP_FIELD_uv_stream_t_loop
  FIELD(uv_stream_t, loop)
#endif
#ifndef SKIP_FIELD_uv_stream_t_type
  FIELD(uv_stream_t, type)
#endif
#ifndef SKIP_FIELD_uv_stream_t_close_cb
  FIELD(uv_stream_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_stream_t_handle_queue
  FIELD(uv_stream_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_stream_t_u
  FIELD(uv_stream_t, u)
#endif
#ifndef SKIP_FIELD_uv_stream_t_endgame_next
  FIELD(uv_stream_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_stream_t_flags
  FIELD(uv_stream_t, flags)
#endif
#ifndef SKIP_FIELD_uv_stream_t_write_queue_size
  FIELD(uv_stream_t, write_queue_size)
#endif
#ifndef SKIP_FIELD_uv_stream_t_alloc_cb
  FIELD(uv_stream_t, alloc_cb)
#endif
#ifndef SKIP_FIELD_uv_stream_t_read_cb
  FIELD(uv_stream_t, read_cb)
#endif
#ifndef SKIP_FIELD_uv_stream_t_reqs_pending
  FIELD(uv_stream_t, reqs_pending)
#endif
#ifndef SKIP_FIELD_uv_stream_t_activecnt
  FIELD(uv_stream_t, activecnt)
#endif
#ifndef SKIP_FIELD_uv_stream_t_read_req
  FIELD(uv_stream_t, read_req)
#endif
#ifndef SKIP_FIELD_uv_stream_t_stream
  FIELD(uv_stream_t, stream)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_write_t
  TYPE_BEGIN(uv_write_t)
#ifndef SKIP_FIELD_uv_write_t_data
  FIELD(uv_write_t, data)
#endif
#ifndef SKIP_FIELD_uv_write_t_type
  FIELD(uv_write_t, type)
#endif
#ifndef SKIP_FIELD_uv_write_t_reserved
  FIELD(uv_write_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_write_t_u
  FIELD(uv_write_t, u)
#endif
#ifndef SKIP_FIELD_uv_write_t_next_req
  FIELD(uv_write_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_write_t_cb
  FIELD(uv_write_t, cb)
#endif
#ifndef SKIP_FIELD_uv_write_t_send_handle
  FIELD(uv_write_t, send_handle)
#endif
#ifndef SKIP_FIELD_uv_write_t_handle
  FIELD(uv_write_t, handle)
#endif
#ifndef SKIP_FIELD_uv_write_t_coalesced
  FIELD(uv_write_t, coalesced)
#endif
#ifndef SKIP_FIELD_uv_write_t_write_buffer
  FIELD(uv_write_t, write_buffer)
#endif
#ifndef SKIP_FIELD_uv_write_t_event_handle
  FIELD(uv_write_t, event_handle)
#endif
#ifndef SKIP_FIELD_uv_write_t_wait_handle
  FIELD(uv_write_t, wait_handle)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_connect_t
  TYPE_BEGIN(uv_connect_t)
#ifndef SKIP_FIELD_uv_connect_t_data
  FIELD(uv_connect_t, data)
#endif
#ifndef SKIP_FIELD_uv_connect_t_type
  FIELD(uv_connect_t, type)
#endif
#ifndef SKIP_FIELD_uv_connect_t_reserved
  FIELD(uv_connect_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_connect_t_u
  FIELD(uv_connect_t, u)
#endif
#ifndef SKIP_FIELD_uv_connect_t_next_req
  FIELD(uv_connect_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_connect_t_cb
  FIELD(uv_connect_t, cb)
#endif
#ifndef SKIP_FIELD_uv_connect_t_handle
  FIELD(uv_connect_t, handle)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_tcp_accept_t
  TYPE_BEGIN(uv_tcp_accept_t)
#ifndef SKIP_FIELD_uv_tcp_accept_t_data
  FIELD(uv_tcp_accept_t, data)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_type
  FIELD(uv_tcp_accept_t, type)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_reserved
  FIELD(uv_tcp_accept_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_u
  FIELD(uv_tcp_accept_t, u)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_next_req
  FIELD(uv_tcp_accept_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_accept_socket
  FIELD(uv_tcp_accept_t, accept_socket)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_accept_buffer
  FIELD(uv_tcp_accept_t, accept_buffer)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_event_handle
  FIELD(uv_tcp_accept_t, event_handle)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_wait_handle
  FIELD(uv_tcp_accept_t, wait_handle)
#endif
#ifndef SKIP_FIELD_uv_tcp_accept_t_next_pending
  FIELD(uv_tcp_accept_t, next_pending)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_tcp_t
  TYPE_BEGIN(uv_tcp_t)
#ifndef SKIP_FIELD_uv_tcp_t_data
  FIELD(uv_tcp_t, data)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_loop
  FIELD(uv_tcp_t, loop)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_type
  FIELD(uv_tcp_t, type)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_close_cb
  FIELD(uv_tcp_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_handle_queue
  FIELD(uv_tcp_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_u
  FIELD(uv_tcp_t, u)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_endgame_next
  FIELD(uv_tcp_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_flags
  FIELD(uv_tcp_t, flags)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_write_queue_size
  FIELD(uv_tcp_t, write_queue_size)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_alloc_cb
  FIELD(uv_tcp_t, alloc_cb)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_read_cb
  FIELD(uv_tcp_t, read_cb)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_reqs_pending
  FIELD(uv_tcp_t, reqs_pending)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_activecnt
  FIELD(uv_tcp_t, activecnt)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_read_req
  FIELD(uv_tcp_t, read_req)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_stream
  FIELD(uv_tcp_t, stream)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_socket
  FIELD(uv_tcp_t, socket)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_delayed_error
  FIELD(uv_tcp_t, delayed_error)
#endif
#ifndef SKIP_FIELD_uv_tcp_t_tcp
  FIELD(uv_tcp_t, tcp)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_udp_t
  TYPE_BEGIN(uv_udp_t)
#ifndef SKIP_FIELD_uv_udp_t_data
  FIELD(uv_udp_t, data)
#endif
#ifndef SKIP_FIELD_uv_udp_t_loop
  FIELD(uv_udp_t, loop)
#endif
#ifndef SKIP_FIELD_uv_udp_t_type
  FIELD(uv_udp_t, type)
#endif
#ifndef SKIP_FIELD_uv_udp_t_close_cb
  FIELD(uv_udp_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_udp_t_handle_queue
  FIELD(uv_udp_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_udp_t_u
  FIELD(uv_udp_t, u)
#endif
#ifndef SKIP_FIELD_uv_udp_t_endgame_next
  FIELD(uv_udp_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_udp_t_flags
  FIELD(uv_udp_t, flags)
#endif
#ifndef SKIP_FIELD_uv_udp_t_send_queue_size
  FIELD(uv_udp_t, send_queue_size)
#endif
#ifndef SKIP_FIELD_uv_udp_t_send_queue_count
  FIELD(uv_udp_t, send_queue_count)
#endif
#ifndef SKIP_FIELD_uv_udp_t_socket
  FIELD(uv_udp_t, socket)
#endif
#ifndef SKIP_FIELD_uv_udp_t_reqs_pending
  FIELD(uv_udp_t, reqs_pending)
#endif
#ifndef SKIP_FIELD_uv_udp_t_activecnt
  FIELD(uv_udp_t, activecnt)
#endif
#ifndef SKIP_FIELD_uv_udp_t_recv_req
  FIELD(uv_udp_t, recv_req)
#endif
#ifndef SKIP_FIELD_uv_udp_t_recv_buffer
  FIELD(uv_udp_t, recv_buffer)
#endif
#ifndef SKIP_FIELD_uv_udp_t_recv_from
  FIELD(uv_udp_t, recv_from)
#endif
#ifndef SKIP_FIELD_uv_udp_t_recv_from_len
  FIELD(uv_udp_t, recv_from_len)
#endif
#ifndef SKIP_FIELD_uv_udp_t_recv_cb
  FIELD(uv_udp_t, recv_cb)
#endif
#ifndef SKIP_FIELD_uv_udp_t_alloc_cb
  FIELD(uv_udp_t, alloc_cb)
#endif
#ifndef SKIP_FIELD_uv_udp_t_func_wsarecv
  FIELD(uv_udp_t, func_wsarecv)
#endif
#ifndef SKIP_FIELD_uv_udp_t_func_wsarecvfrom
  FIELD(uv_udp_t, func_wsarecvfrom)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_udp_send_t
  TYPE_BEGIN(uv_udp_send_t)
#ifndef SKIP_FIELD_uv_udp_send_t_data
  FIELD(uv_udp_send_t, data)
#endif
#ifndef SKIP_FIELD_uv_udp_send_t_type
  FIELD(uv_udp_send_t, type)
#endif
#ifndef SKIP_FIELD_uv_udp_send_t_reserved
  FIELD(uv_udp_send_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_udp_send_t_u
  FIELD(uv_udp_send_t, u)
#endif
#ifndef SKIP_FIELD_uv_udp_send_t_next_req
  FIELD(uv_udp_send_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_udp_send_t_handle
  FIELD(uv_udp_send_t, handle)
#endif
#ifndef SKIP_FIELD_uv_udp_send_t_cb
  FIELD(uv_udp_send_t, cb)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_pipe_accept_t
  TYPE_BEGIN(uv_pipe_accept_t)
#ifndef SKIP_FIELD_uv_pipe_accept_t_data
  FIELD(uv_pipe_accept_t, data)
#endif
#ifndef SKIP_FIELD_uv_pipe_accept_t_type
  FIELD(uv_pipe_accept_t, type)
#endif
#ifndef SKIP_FIELD_uv_pipe_accept_t_reserved
  FIELD(uv_pipe_accept_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_pipe_accept_t_u
  FIELD(uv_pipe_accept_t, u)
#endif
#ifndef SKIP_FIELD_uv_pipe_accept_t_next_req
  FIELD(uv_pipe_accept_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_pipe_accept_t_pipeHandle
  FIELD(uv_pipe_accept_t, pipeHandle)
#endif
#ifndef SKIP_FIELD_uv_pipe_accept_t_next_pending
  FIELD(uv_pipe_accept_t, next_pending)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_pipe_t
  TYPE_BEGIN(uv_pipe_t)
#ifndef SKIP_FIELD_uv_pipe_t_data
  FIELD(uv_pipe_t, data)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_loop
  FIELD(uv_pipe_t, loop)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_type
  FIELD(uv_pipe_t, type)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_close_cb
  FIELD(uv_pipe_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_handle_queue
  FIELD(uv_pipe_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_u
  FIELD(uv_pipe_t, u)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_endgame_next
  FIELD(uv_pipe_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_flags
  FIELD(uv_pipe_t, flags)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_write_queue_size
  FIELD(uv_pipe_t, write_queue_size)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_alloc_cb
  FIELD(uv_pipe_t, alloc_cb)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_read_cb
  FIELD(uv_pipe_t, read_cb)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_reqs_pending
  FIELD(uv_pipe_t, reqs_pending)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_activecnt
  FIELD(uv_pipe_t, activecnt)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_read_req
  FIELD(uv_pipe_t, read_req)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_stream
  FIELD(uv_pipe_t, stream)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_ipc
  FIELD(uv_pipe_t, ipc)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_handle
  FIELD(uv_pipe_t, handle)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_name
  FIELD(uv_pipe_t, name)
#endif
#ifndef SKIP_FIELD_uv_pipe_t_pipe
  FIELD(uv_pipe_t, pipe)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_tty_t
  TYPE_BEGIN(uv_tty_t)
#ifndef SKIP_FIELD_uv_tty_t_data
  FIELD(uv_tty_t, data)
#endif
#ifndef SKIP_FIELD_uv_tty_t_loop
  FIELD(uv_tty_t, loop)
#endif
#ifndef SKIP_FIELD_uv_tty_t_type
  FIELD(uv_tty_t, type)
#endif
#ifndef SKIP_FIELD_uv_tty_t_close_cb
  FIELD(uv_tty_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_tty_t_handle_queue
  FIELD(uv_tty_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_tty_t_u
  FIELD(uv_tty_t, u)
#endif
#ifndef SKIP_FIELD_uv_tty_t_endgame_next
  FIELD(uv_tty_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_tty_t_flags
  FIELD(uv_tty_t, flags)
#endif
#ifndef SKIP_FIELD_uv_tty_t_write_queue_size
  FIELD(uv_tty_t, write_queue_size)
#endif
#ifndef SKIP_FIELD_uv_tty_t_alloc_cb
  FIELD(uv_tty_t, alloc_cb)
#endif
#ifndef SKIP_FIELD_uv_tty_t_read_cb
  FIELD(uv_tty_t, read_cb)
#endif
#ifndef SKIP_FIELD_uv_tty_t_reqs_pending
  FIELD(uv_tty_t, reqs_pending)
#endif
#ifndef SKIP_FIELD_uv_tty_t_activecnt
  FIELD(uv_tty_t, activecnt)
#endif
#ifndef SKIP_FIELD_uv_tty_t_read_req
  FIELD(uv_tty_t, read_req)
#endif
#ifndef SKIP_FIELD_uv_tty_t_stream
  FIELD(uv_tty_t, stream)
#endif
#ifndef SKIP_FIELD_uv_tty_t_handle
  FIELD(uv_tty_t, handle)
#endif
#ifndef SKIP_FIELD_uv_tty_t_tty
  FIELD(uv_tty_t, tty)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_Tty
  TYPE_BEGIN(Tty)
#ifndef SKIP_FIELD_Tty_uv
  FIELD(Tty, uv)
#endif
#ifndef SKIP_FIELD_Tty_read_scratch
  FIELD(Tty, read_scratch)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_AFD_POLL_HANDLE_INFO
  TYPE_BEGIN(AFD_POLL_HANDLE_INFO)
#ifndef SKIP_FIELD_AFD_POLL_HANDLE_INFO_Handle
  FIELD(AFD_POLL_HANDLE_INFO, Handle)
#endif
#ifndef SKIP_FIELD_AFD_POLL_HANDLE_INFO_Events
  FIELD(AFD_POLL_HANDLE_INFO, Events)
#endif
#ifndef SKIP_FIELD_AFD_POLL_HANDLE_INFO_Status
  FIELD(AFD_POLL_HANDLE_INFO, Status)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_AFD_POLL_INFO
  TYPE_BEGIN(AFD_POLL_INFO)
#ifndef SKIP_FIELD_AFD_POLL_INFO_Timeout
  FIELD(AFD_POLL_INFO, Timeout)
#endif
#ifndef SKIP_FIELD_AFD_POLL_INFO_NumberOfHandles
  FIELD(AFD_POLL_INFO, NumberOfHandles)
#endif
#ifndef SKIP_FIELD_AFD_POLL_INFO_Exclusive
  FIELD(AFD_POLL_INFO, Exclusive)
#endif
#ifndef SKIP_FIELD_AFD_POLL_INFO_Handles
  FIELD(AFD_POLL_INFO, Handles)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_poll_t
  TYPE_BEGIN(uv_poll_t)
#ifndef SKIP_FIELD_uv_poll_t_data
  FIELD(uv_poll_t, data)
#endif
#ifndef SKIP_FIELD_uv_poll_t_loop
  FIELD(uv_poll_t, loop)
#endif
#ifndef SKIP_FIELD_uv_poll_t_type
  FIELD(uv_poll_t, type)
#endif
#ifndef SKIP_FIELD_uv_poll_t_close_cb
  FIELD(uv_poll_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_poll_t_handle_queue
  FIELD(uv_poll_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_poll_t_u
  FIELD(uv_poll_t, u)
#endif
#ifndef SKIP_FIELD_uv_poll_t_endgame_next
  FIELD(uv_poll_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_poll_t_flags
  FIELD(uv_poll_t, flags)
#endif
#ifndef SKIP_FIELD_uv_poll_t_poll_cb
  FIELD(uv_poll_t, poll_cb)
#endif
#ifndef SKIP_FIELD_uv_poll_t_socket
  FIELD(uv_poll_t, socket)
#endif
#ifndef SKIP_FIELD_uv_poll_t_peer_socket
  FIELD(uv_poll_t, peer_socket)
#endif
#ifndef SKIP_FIELD_uv_poll_t_afd_poll_info_1
  FIELD(uv_poll_t, afd_poll_info_1)
#endif
#ifndef SKIP_FIELD_uv_poll_t_afd_poll_info_2
  FIELD(uv_poll_t, afd_poll_info_2)
#endif
#ifndef SKIP_FIELD_uv_poll_t_poll_req_1
  FIELD(uv_poll_t, poll_req_1)
#endif
#ifndef SKIP_FIELD_uv_poll_t_poll_req_2
  FIELD(uv_poll_t, poll_req_2)
#endif
#ifndef SKIP_FIELD_uv_poll_t_submitted_events_1
  FIELD(uv_poll_t, submitted_events_1)
#endif
#ifndef SKIP_FIELD_uv_poll_t_submitted_events_2
  FIELD(uv_poll_t, submitted_events_2)
#endif
#ifndef SKIP_FIELD_uv_poll_t_mask_events_1
  FIELD(uv_poll_t, mask_events_1)
#endif
#ifndef SKIP_FIELD_uv_poll_t_mask_events_2
  FIELD(uv_poll_t, mask_events_2)
#endif
#ifndef SKIP_FIELD_uv_poll_t_events
  FIELD(uv_poll_t, events)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_timer_t
  TYPE_BEGIN(uv_timer_t)
#ifndef SKIP_FIELD_uv_timer_t_data
  FIELD(uv_timer_t, data)
#endif
#ifndef SKIP_FIELD_uv_timer_t_loop
  FIELD(uv_timer_t, loop)
#endif
#ifndef SKIP_FIELD_uv_timer_t_type
  FIELD(uv_timer_t, type)
#endif
#ifndef SKIP_FIELD_uv_timer_t_close_cb
  FIELD(uv_timer_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_timer_t_handle_queue
  FIELD(uv_timer_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_timer_t_u
  FIELD(uv_timer_t, u)
#endif
#ifndef SKIP_FIELD_uv_timer_t_endgame_next
  FIELD(uv_timer_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_timer_t_flags
  FIELD(uv_timer_t, flags)
#endif
#ifndef SKIP_FIELD_uv_timer_t_heap_node
  FIELD(uv_timer_t, heap_node)
#endif
#ifndef SKIP_FIELD_uv_timer_t_unused
  FIELD(uv_timer_t, unused)
#endif
#ifndef SKIP_FIELD_uv_timer_t_timeout
  FIELD(uv_timer_t, timeout)
#endif
#ifndef SKIP_FIELD_uv_timer_t_repeat
  FIELD(uv_timer_t, repeat)
#endif
#ifndef SKIP_FIELD_uv_timer_t_start_id
  FIELD(uv_timer_t, start_id)
#endif
#ifndef SKIP_FIELD_uv_timer_t_timer_cb
  FIELD(uv_timer_t, timer_cb)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_prepare_t
  TYPE_BEGIN(uv_prepare_t)
#ifndef SKIP_FIELD_uv_prepare_t_data
  FIELD(uv_prepare_t, data)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_loop
  FIELD(uv_prepare_t, loop)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_type
  FIELD(uv_prepare_t, type)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_close_cb
  FIELD(uv_prepare_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_handle_queue
  FIELD(uv_prepare_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_u
  FIELD(uv_prepare_t, u)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_endgame_next
  FIELD(uv_prepare_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_flags
  FIELD(uv_prepare_t, flags)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_prepare_prev
  FIELD(uv_prepare_t, prepare_prev)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_prepare_next
  FIELD(uv_prepare_t, prepare_next)
#endif
#ifndef SKIP_FIELD_uv_prepare_t_prepare_cb
  FIELD(uv_prepare_t, prepare_cb)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_check_t
  TYPE_BEGIN(uv_check_t)
#ifndef SKIP_FIELD_uv_check_t_data
  FIELD(uv_check_t, data)
#endif
#ifndef SKIP_FIELD_uv_check_t_loop
  FIELD(uv_check_t, loop)
#endif
#ifndef SKIP_FIELD_uv_check_t_type
  FIELD(uv_check_t, type)
#endif
#ifndef SKIP_FIELD_uv_check_t_close_cb
  FIELD(uv_check_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_check_t_handle_queue
  FIELD(uv_check_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_check_t_u
  FIELD(uv_check_t, u)
#endif
#ifndef SKIP_FIELD_uv_check_t_endgame_next
  FIELD(uv_check_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_check_t_flags
  FIELD(uv_check_t, flags)
#endif
#ifndef SKIP_FIELD_uv_check_t_check_prev
  FIELD(uv_check_t, check_prev)
#endif
#ifndef SKIP_FIELD_uv_check_t_check_next
  FIELD(uv_check_t, check_next)
#endif
#ifndef SKIP_FIELD_uv_check_t_check_cb
  FIELD(uv_check_t, check_cb)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_idle_t
  TYPE_BEGIN(uv_idle_t)
#ifndef SKIP_FIELD_uv_idle_t_data
  FIELD(uv_idle_t, data)
#endif
#ifndef SKIP_FIELD_uv_idle_t_loop
  FIELD(uv_idle_t, loop)
#endif
#ifndef SKIP_FIELD_uv_idle_t_type
  FIELD(uv_idle_t, type)
#endif
#ifndef SKIP_FIELD_uv_idle_t_close_cb
  FIELD(uv_idle_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_idle_t_handle_queue
  FIELD(uv_idle_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_idle_t_u
  FIELD(uv_idle_t, u)
#endif
#ifndef SKIP_FIELD_uv_idle_t_endgame_next
  FIELD(uv_idle_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_idle_t_flags
  FIELD(uv_idle_t, flags)
#endif
#ifndef SKIP_FIELD_uv_idle_t_idle_prev
  FIELD(uv_idle_t, idle_prev)
#endif
#ifndef SKIP_FIELD_uv_idle_t_idle_next
  FIELD(uv_idle_t, idle_next)
#endif
#ifndef SKIP_FIELD_uv_idle_t_idle_cb
  FIELD(uv_idle_t, idle_cb)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_async_t
  TYPE_BEGIN(uv_async_t)
#ifndef SKIP_FIELD_uv_async_t_data
  FIELD(uv_async_t, data)
#endif
#ifndef SKIP_FIELD_uv_async_t_loop
  FIELD(uv_async_t, loop)
#endif
#ifndef SKIP_FIELD_uv_async_t_type
  FIELD(uv_async_t, type)
#endif
#ifndef SKIP_FIELD_uv_async_t_close_cb
  FIELD(uv_async_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_async_t_handle_queue
  FIELD(uv_async_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_async_t_u
  FIELD(uv_async_t, u)
#endif
#ifndef SKIP_FIELD_uv_async_t_endgame_next
  FIELD(uv_async_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_async_t_flags
  FIELD(uv_async_t, flags)
#endif
#ifndef SKIP_FIELD_uv_async_t_async_req
  FIELD(uv_async_t, async_req)
#endif
#ifndef SKIP_FIELD_uv_async_t_async_cb
  FIELD(uv_async_t, async_cb)
#endif
#ifndef SKIP_FIELD_uv_async_t_async_sent
  FIELD(uv_async_t, async_sent)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_process_exit_t
  TYPE_BEGIN(uv_process_exit_t)
#ifndef SKIP_FIELD_uv_process_exit_t_data
  FIELD(uv_process_exit_t, data)
#endif
#ifndef SKIP_FIELD_uv_process_exit_t_type
  FIELD(uv_process_exit_t, type)
#endif
#ifndef SKIP_FIELD_uv_process_exit_t_reserved
  FIELD(uv_process_exit_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_process_exit_t_u
  FIELD(uv_process_exit_t, u)
#endif
#ifndef SKIP_FIELD_uv_process_exit_t_next_req
  FIELD(uv_process_exit_t, next_req)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_process_t
  TYPE_BEGIN(uv_process_t)
#ifndef SKIP_FIELD_uv_process_t_data
  FIELD(uv_process_t, data)
#endif
#ifndef SKIP_FIELD_uv_process_t_loop
  FIELD(uv_process_t, loop)
#endif
#ifndef SKIP_FIELD_uv_process_t_type
  FIELD(uv_process_t, type)
#endif
#ifndef SKIP_FIELD_uv_process_t_close_cb
  FIELD(uv_process_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_process_t_handle_queue
  FIELD(uv_process_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_process_t_u
  FIELD(uv_process_t, u)
#endif
#ifndef SKIP_FIELD_uv_process_t_endgame_next
  FIELD(uv_process_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_process_t_flags
  FIELD(uv_process_t, flags)
#endif
#ifndef SKIP_FIELD_uv_process_t_exit_cb
  FIELD(uv_process_t, exit_cb)
#endif
#ifndef SKIP_FIELD_uv_process_t_pid
  FIELD(uv_process_t, pid)
#endif
#ifndef SKIP_FIELD_uv_process_t_exit_req
  FIELD(uv_process_t, exit_req)
#endif
#ifndef SKIP_FIELD_uv_process_t_unused
  FIELD(uv_process_t, unused)
#endif
#ifndef SKIP_FIELD_uv_process_t_exit_signal
  FIELD(uv_process_t, exit_signal)
#endif
#ifndef SKIP_FIELD_uv_process_t_wait_handle
  FIELD(uv_process_t, wait_handle)
#endif
#ifndef SKIP_FIELD_uv_process_t_process_handle
  FIELD(uv_process_t, process_handle)
#endif
#ifndef SKIP_FIELD_uv_process_t_exit_cb_pending
  FIELD(uv_process_t, exit_cb_pending)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_stdio_container_data
  TYPE_BEGIN(uv_stdio_container_data)
#ifndef SKIP_FIELD_uv_stdio_container_data_stream
  FIELD(uv_stdio_container_data, stream)
#endif
#ifndef SKIP_FIELD_uv_stdio_container_data_fd
  FIELD(uv_stdio_container_data, fd)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_stdio_container_t
  TYPE_BEGIN(uv_stdio_container_t)
#ifndef SKIP_FIELD_uv_stdio_container_t_flags
  FIELD(uv_stdio_container_t, flags)
#endif
#ifndef SKIP_FIELD_uv_stdio_container_t_data
  FIELD(uv_stdio_container_t, data)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_process_options_t
  TYPE_BEGIN(uv_process_options_t)
#ifndef SKIP_FIELD_uv_process_options_t_exit_cb
  FIELD(uv_process_options_t, exit_cb)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_file
  FIELD(uv_process_options_t, file)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_args
  FIELD(uv_process_options_t, args)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_env
  FIELD(uv_process_options_t, env)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_cwd
  FIELD(uv_process_options_t, cwd)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_flags
  FIELD(uv_process_options_t, flags)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_stdio_count
  FIELD(uv_process_options_t, stdio_count)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_stdio
  FIELD(uv_process_options_t, stdio)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_uid
  FIELD(uv_process_options_t, uid)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_gid
  FIELD(uv_process_options_t, gid)
#endif
#ifndef SKIP_FIELD_uv_process_options_t_pseudoconsole
  FIELD(uv_process_options_t, pseudoconsole)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_fs_event_req_t
  TYPE_BEGIN(uv_fs_event_req_t)
#ifndef SKIP_FIELD_uv_fs_event_req_t_data
  FIELD(uv_fs_event_req_t, data)
#endif
#ifndef SKIP_FIELD_uv_fs_event_req_t_type
  FIELD(uv_fs_event_req_t, type)
#endif
#ifndef SKIP_FIELD_uv_fs_event_req_t_reserved
  FIELD(uv_fs_event_req_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_fs_event_req_t_u
  FIELD(uv_fs_event_req_t, u)
#endif
#ifndef SKIP_FIELD_uv_fs_event_req_t_next_req
  FIELD(uv_fs_event_req_t, next_req)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_fs_event_t
  TYPE_BEGIN(uv_fs_event_t)
#ifndef SKIP_FIELD_uv_fs_event_t_data
  FIELD(uv_fs_event_t, data)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_loop
  FIELD(uv_fs_event_t, loop)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_type
  FIELD(uv_fs_event_t, type)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_close_cb
  FIELD(uv_fs_event_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_handle_queue
  FIELD(uv_fs_event_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_u
  FIELD(uv_fs_event_t, u)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_endgame_next
  FIELD(uv_fs_event_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_flags
  FIELD(uv_fs_event_t, flags)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_path
  FIELD(uv_fs_event_t, path)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_req
  FIELD(uv_fs_event_t, req)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_dir_handle
  FIELD(uv_fs_event_t, dir_handle)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_req_pending
  FIELD(uv_fs_event_t, req_pending)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_cb
  FIELD(uv_fs_event_t, cb)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_filew
  FIELD(uv_fs_event_t, filew)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_short_filew
  FIELD(uv_fs_event_t, short_filew)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_dirw
  FIELD(uv_fs_event_t, dirw)
#endif
#ifndef SKIP_FIELD_uv_fs_event_t_buffer
  FIELD(uv_fs_event_t, buffer)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_fs_poll_t
  TYPE_BEGIN(uv_fs_poll_t)
#ifndef SKIP_FIELD_uv_fs_poll_t_data
  FIELD(uv_fs_poll_t, data)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_loop
  FIELD(uv_fs_poll_t, loop)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_type
  FIELD(uv_fs_poll_t, type)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_close_cb
  FIELD(uv_fs_poll_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_handle_queue
  FIELD(uv_fs_poll_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_u
  FIELD(uv_fs_poll_t, u)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_endgame_next
  FIELD(uv_fs_poll_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_flags
  FIELD(uv_fs_poll_t, flags)
#endif
#ifndef SKIP_FIELD_uv_fs_poll_t_poll_ctx
  FIELD(uv_fs_poll_t, poll_ctx)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_signal_t
  TYPE_BEGIN(uv_signal_t)
#ifndef SKIP_FIELD_uv_signal_t_data
  FIELD(uv_signal_t, data)
#endif
#ifndef SKIP_FIELD_uv_signal_t_loop
  FIELD(uv_signal_t, loop)
#endif
#ifndef SKIP_FIELD_uv_signal_t_type
  FIELD(uv_signal_t, type)
#endif
#ifndef SKIP_FIELD_uv_signal_t_close_cb
  FIELD(uv_signal_t, close_cb)
#endif
#ifndef SKIP_FIELD_uv_signal_t_handle_queue
  FIELD(uv_signal_t, handle_queue)
#endif
#ifndef SKIP_FIELD_uv_signal_t_u
  FIELD(uv_signal_t, u)
#endif
#ifndef SKIP_FIELD_uv_signal_t_endgame_next
  FIELD(uv_signal_t, endgame_next)
#endif
#ifndef SKIP_FIELD_uv_signal_t_flags
  FIELD(uv_signal_t, flags)
#endif
#ifndef SKIP_FIELD_uv_signal_t_signal_cb
  FIELD(uv_signal_t, signal_cb)
#endif
#ifndef SKIP_FIELD_uv_signal_t_signum
  FIELD(uv_signal_t, signum)
#endif
#ifndef SKIP_FIELD_uv_signal_t_tree_entry
  FIELD(uv_signal_t, tree_entry)
#endif
#ifndef SKIP_FIELD_uv_signal_t_signal_req
  FIELD(uv_signal_t, signal_req)
#endif
#ifndef SKIP_FIELD_uv_signal_t_pending_signum
  FIELD(uv_signal_t, pending_signum)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_getaddrinfo_t
  TYPE_BEGIN(uv_getaddrinfo_t)
#ifndef SKIP_FIELD_uv_getaddrinfo_t_data
  FIELD(uv_getaddrinfo_t, data)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_type
  FIELD(uv_getaddrinfo_t, type)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_reserved
  FIELD(uv_getaddrinfo_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_u
  FIELD(uv_getaddrinfo_t, u)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_next_req
  FIELD(uv_getaddrinfo_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_loop
  FIELD(uv_getaddrinfo_t, loop)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_work_req
  FIELD(uv_getaddrinfo_t, work_req)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_getaddrinfo_cb
  FIELD(uv_getaddrinfo_t, getaddrinfo_cb)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_alloc
  FIELD(uv_getaddrinfo_t, alloc)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_node
  FIELD(uv_getaddrinfo_t, node)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_service
  FIELD(uv_getaddrinfo_t, service)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_addrinfow
  FIELD(uv_getaddrinfo_t, addrinfow)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_addrinfo
  FIELD(uv_getaddrinfo_t, addrinfo)
#endif
#ifndef SKIP_FIELD_uv_getaddrinfo_t_retcode
  FIELD(uv_getaddrinfo_t, retcode)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_work_t
  TYPE_BEGIN(uv_work_t)
#ifndef SKIP_FIELD_uv_work_t_data
  FIELD(uv_work_t, data)
#endif
#ifndef SKIP_FIELD_uv_work_t_type
  FIELD(uv_work_t, type)
#endif
#ifndef SKIP_FIELD_uv_work_t_reserved
  FIELD(uv_work_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_work_t_u
  FIELD(uv_work_t, u)
#endif
#ifndef SKIP_FIELD_uv_work_t_next_req
  FIELD(uv_work_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_work_t_loop
  FIELD(uv_work_t, loop)
#endif
#ifndef SKIP_FIELD_uv_work_t_work_cb
  FIELD(uv_work_t, work_cb)
#endif
#ifndef SKIP_FIELD_uv_work_t_after_work_cb
  FIELD(uv_work_t, after_work_cb)
#endif
#ifndef SKIP_FIELD_uv_work_t_work_req
  FIELD(uv_work_t, work_req)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_timespec_t
  TYPE_BEGIN(uv_timespec_t)
#ifndef SKIP_FIELD_uv_timespec_t_sec
  FIELD(uv_timespec_t, sec)
#endif
#ifndef SKIP_FIELD_uv_timespec_t_nsec
  FIELD(uv_timespec_t, nsec)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_timeval_t
  TYPE_BEGIN(uv_timeval_t)
#ifndef SKIP_FIELD_uv_timeval_t_sec
  FIELD(uv_timeval_t, sec)
#endif
#ifndef SKIP_FIELD_uv_timeval_t_usec
  FIELD(uv_timeval_t, usec)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_stat_t
  TYPE_BEGIN(uv_stat_t)
#ifndef SKIP_FIELD_uv_stat_t_st_dev
  FIELD(uv_stat_t, st_dev)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_mode
  FIELD(uv_stat_t, st_mode)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_nlink
  FIELD(uv_stat_t, st_nlink)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_uid
  FIELD(uv_stat_t, st_uid)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_gid
  FIELD(uv_stat_t, st_gid)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_rdev
  FIELD(uv_stat_t, st_rdev)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_ino
  FIELD(uv_stat_t, st_ino)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_size
  FIELD(uv_stat_t, st_size)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_blksize
  FIELD(uv_stat_t, st_blksize)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_blocks
  FIELD(uv_stat_t, st_blocks)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_flags
  FIELD(uv_stat_t, st_flags)
#endif
#ifndef SKIP_FIELD_uv_stat_t_st_gen
  FIELD(uv_stat_t, st_gen)
#endif
#ifndef SKIP_FIELD_uv_stat_t_atim
  FIELD(uv_stat_t, atim)
#endif
#ifndef SKIP_FIELD_uv_stat_t_mtim
  FIELD(uv_stat_t, mtim)
#endif
#ifndef SKIP_FIELD_uv_stat_t_ctim
  FIELD(uv_stat_t, ctim)
#endif
#ifndef SKIP_FIELD_uv_stat_t_birthtim
  FIELD(uv_stat_t, birthtim)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_fs_t
  TYPE_BEGIN(uv_fs_t)
#ifndef SKIP_FIELD_uv_fs_t_data
  FIELD(uv_fs_t, data)
#endif
#ifndef SKIP_FIELD_uv_fs_t_type
  FIELD(uv_fs_t, type)
#endif
#ifndef SKIP_FIELD_uv_fs_t_reserved
  FIELD(uv_fs_t, reserved)
#endif
#ifndef SKIP_FIELD_uv_fs_t_u
  FIELD(uv_fs_t, u)
#endif
#ifndef SKIP_FIELD_uv_fs_t_next_req
  FIELD(uv_fs_t, next_req)
#endif
#ifndef SKIP_FIELD_uv_fs_t_fs_type
  FIELD(uv_fs_t, fs_type)
#endif
#ifndef SKIP_FIELD_uv_fs_t_loop
  FIELD(uv_fs_t, loop)
#endif
#ifndef SKIP_FIELD_uv_fs_t_cb
  FIELD(uv_fs_t, cb)
#endif
#ifndef SKIP_FIELD_uv_fs_t_result
  FIELD(uv_fs_t, result)
#endif
#ifndef SKIP_FIELD_uv_fs_t_ptr
  FIELD(uv_fs_t, ptr)
#endif
#ifndef SKIP_FIELD_uv_fs_t_path
  FIELD(uv_fs_t, path)
#endif
#ifndef SKIP_FIELD_uv_fs_t_statbuf
  FIELD(uv_fs_t, statbuf)
#endif
#ifndef SKIP_FIELD_uv_fs_t_work_req
  FIELD(uv_fs_t, work_req)
#endif
#ifndef SKIP_FIELD_uv_fs_t_flags
  FIELD(uv_fs_t, flags)
#endif
#ifndef SKIP_FIELD_uv_fs_t_sys_errno_
  FIELD(uv_fs_t, sys_errno_)
#endif
#ifndef SKIP_FIELD_uv_fs_t_file
  FIELD(uv_fs_t, file)
#endif
#ifndef SKIP_FIELD_uv_fs_t_fs
  FIELD(uv_fs_t, fs)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_cpu_times_t
  TYPE_BEGIN(uv_cpu_times_t)
#ifndef SKIP_FIELD_uv_cpu_times_t_user
  FIELD(uv_cpu_times_t, user)
#endif
#ifndef SKIP_FIELD_uv_cpu_times_t_nice
  FIELD(uv_cpu_times_t, nice)
#endif
#ifndef SKIP_FIELD_uv_cpu_times_t_sys
  FIELD(uv_cpu_times_t, sys)
#endif
#ifndef SKIP_FIELD_uv_cpu_times_t_idle
  FIELD(uv_cpu_times_t, idle)
#endif
#ifndef SKIP_FIELD_uv_cpu_times_t_irq
  FIELD(uv_cpu_times_t, irq)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_cpu_info_t
  TYPE_BEGIN(uv_cpu_info_t)
#ifndef SKIP_FIELD_uv_cpu_info_t_model
  FIELD(uv_cpu_info_t, model)
#endif
#ifndef SKIP_FIELD_uv_cpu_info_t_speed
  FIELD(uv_cpu_info_t, speed)
#endif
#ifndef SKIP_FIELD_uv_cpu_info_t_cpu_times
  FIELD(uv_cpu_info_t, cpu_times)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_addr_union
  TYPE_BEGIN(addr_union)
#ifndef SKIP_FIELD_addr_union_address4
  FIELD(addr_union, address4)
#endif
#ifndef SKIP_FIELD_addr_union_address6
  FIELD(addr_union, address6)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_netmask_union
  TYPE_BEGIN(netmask_union)
#ifndef SKIP_FIELD_netmask_union_netmask4
  FIELD(netmask_union, netmask4)
#endif
#ifndef SKIP_FIELD_netmask_union_netmask6
  FIELD(netmask_union, netmask6)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_interface_address_t
  TYPE_BEGIN(uv_interface_address_t)
#ifndef SKIP_FIELD_uv_interface_address_t_name
  FIELD(uv_interface_address_t, name)
#endif
#ifndef SKIP_FIELD_uv_interface_address_t_phys_addr
  FIELD(uv_interface_address_t, phys_addr)
#endif
#ifndef SKIP_FIELD_uv_interface_address_t_is_internal
  FIELD(uv_interface_address_t, is_internal)
#endif
#ifndef SKIP_FIELD_uv_interface_address_t_address
  FIELD(uv_interface_address_t, address)
#endif
#ifndef SKIP_FIELD_uv_interface_address_t_netmask
  FIELD(uv_interface_address_t, netmask)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_utsname_t
  TYPE_BEGIN(uv_utsname_t)
#ifndef SKIP_FIELD_uv_utsname_t_sysname
  FIELD(uv_utsname_t, sysname)
#endif
#ifndef SKIP_FIELD_uv_utsname_t_release
  FIELD(uv_utsname_t, release)
#endif
#ifndef SKIP_FIELD_uv_utsname_t_version
  FIELD(uv_utsname_t, version)
#endif
#ifndef SKIP_FIELD_uv_utsname_t_machine
  FIELD(uv_utsname_t, machine)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_statfs_t
  TYPE_BEGIN(uv_statfs_t)
#ifndef SKIP_FIELD_uv_statfs_t_f_type
  FIELD(uv_statfs_t, f_type)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_bsize
  FIELD(uv_statfs_t, f_bsize)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_blocks
  FIELD(uv_statfs_t, f_blocks)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_bfree
  FIELD(uv_statfs_t, f_bfree)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_bavail
  FIELD(uv_statfs_t, f_bavail)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_files
  FIELD(uv_statfs_t, f_files)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_ffree
  FIELD(uv_statfs_t, f_ffree)
#endif
#ifndef SKIP_FIELD_uv_statfs_t_f_spare
  FIELD(uv_statfs_t, f_spare)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_uv_rusage_t
  TYPE_BEGIN(uv_rusage_t)
#ifndef SKIP_FIELD_uv_rusage_t_ru_utime
  FIELD(uv_rusage_t, ru_utime)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_stime
  FIELD(uv_rusage_t, ru_stime)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_maxrss
  FIELD(uv_rusage_t, ru_maxrss)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_ixrss
  FIELD(uv_rusage_t, ru_ixrss)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_idrss
  FIELD(uv_rusage_t, ru_idrss)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_isrss
  FIELD(uv_rusage_t, ru_isrss)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_minflt
  FIELD(uv_rusage_t, ru_minflt)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_majflt
  FIELD(uv_rusage_t, ru_majflt)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_nswap
  FIELD(uv_rusage_t, ru_nswap)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_inblock
  FIELD(uv_rusage_t, ru_inblock)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_oublock
  FIELD(uv_rusage_t, ru_oublock)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_msgsnd
  FIELD(uv_rusage_t, ru_msgsnd)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_msgrcv
  FIELD(uv_rusage_t, ru_msgrcv)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_nsignals
  FIELD(uv_rusage_t, ru_nsignals)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_nvcsw
  FIELD(uv_rusage_t, ru_nvcsw)
#endif
#ifndef SKIP_FIELD_uv_rusage_t_ru_nivcsw
  FIELD(uv_rusage_t, ru_nivcsw)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_FILE_NOTIFY_INFORMATION
  TYPE_BEGIN(FILE_NOTIFY_INFORMATION)
#ifndef SKIP_FIELD_FILE_NOTIFY_INFORMATION_NextEntryOffset
  FIELD(FILE_NOTIFY_INFORMATION, NextEntryOffset)
#endif
#ifndef SKIP_FIELD_FILE_NOTIFY_INFORMATION_Action
  FIELD(FILE_NOTIFY_INFORMATION, Action)
#endif
#ifndef SKIP_FIELD_FILE_NOTIFY_INFORMATION_FileNameLength
  FIELD(FILE_NOTIFY_INFORMATION, FileNameLength)
#endif
#ifndef SKIP_FIELD_FILE_NOTIFY_INFORMATION_FileName
  FIELD(FILE_NOTIFY_INFORMATION, FileName)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_EXCEPTION_RECORD
  TYPE_BEGIN(EXCEPTION_RECORD)
#ifndef SKIP_FIELD_EXCEPTION_RECORD_ExceptionCode
  FIELD(EXCEPTION_RECORD, ExceptionCode)
#endif
#ifndef SKIP_FIELD_EXCEPTION_RECORD_ExceptionFlags
  FIELD(EXCEPTION_RECORD, ExceptionFlags)
#endif
#ifndef SKIP_FIELD_EXCEPTION_RECORD_ExceptionRecord
  FIELD(EXCEPTION_RECORD, ExceptionRecord)
#endif
#ifndef SKIP_FIELD_EXCEPTION_RECORD_ExceptionAddress
  FIELD(EXCEPTION_RECORD, ExceptionAddress)
#endif
#ifndef SKIP_FIELD_EXCEPTION_RECORD_NumberParameters
  FIELD(EXCEPTION_RECORD, NumberParameters)
#endif
#ifndef SKIP_FIELD_EXCEPTION_RECORD_ExceptionInformation
  FIELD(EXCEPTION_RECORD, ExceptionInformation)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_EXCEPTION_POINTERS
  TYPE_BEGIN(EXCEPTION_POINTERS)
#ifndef SKIP_FIELD_EXCEPTION_POINTERS_ExceptionRecord
  FIELD(EXCEPTION_POINTERS, ExceptionRecord)
#endif
#ifndef SKIP_FIELD_EXCEPTION_POINTERS_ContextRecord
  FIELD(EXCEPTION_POINTERS, ContextRecord)
#endif
  TYPE_END
#endif
#ifndef SKIP_TYPE_PROCESS_MEMORY_COUNTERS
  TYPE_BEGIN(PROCESS_MEMORY_COUNTERS)
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_cb
  FIELD(PROCESS_MEMORY_COUNTERS, cb)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_PageFaultCount
  FIELD(PROCESS_MEMORY_COUNTERS, PageFaultCount)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_PeakWorkingSetSize
  FIELD(PROCESS_MEMORY_COUNTERS, PeakWorkingSetSize)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_WorkingSetSize
  FIELD(PROCESS_MEMORY_COUNTERS, WorkingSetSize)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_QuotaPeakPagedPoolUsage
  FIELD(PROCESS_MEMORY_COUNTERS, QuotaPeakPagedPoolUsage)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_QuotaPagedPoolUsage
  FIELD(PROCESS_MEMORY_COUNTERS, QuotaPagedPoolUsage)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_QuotaPeakNonPagedPoolUsage
  FIELD(PROCESS_MEMORY_COUNTERS, QuotaPeakNonPagedPoolUsage)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_QuotaNonPagedPoolUsage
  FIELD(PROCESS_MEMORY_COUNTERS, QuotaNonPagedPoolUsage)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_PagefileUsage
  FIELD(PROCESS_MEMORY_COUNTERS, PagefileUsage)
#endif
#ifndef SKIP_FIELD_PROCESS_MEMORY_COUNTERS_PeakPagefileUsage
  FIELD(PROCESS_MEMORY_COUNTERS, PeakPagefileUsage)
#endif
  TYPE_END
#endif
  printf("\n},\"constants\":{");
  first = 1;
#ifndef SKIP_CONSTANT_FALSE
  CONSTANT_SIGNED(FALSE)
#endif
#ifndef SKIP_CONSTANT_TRUE
  CONSTANT_SIGNED(TRUE)
#endif
#ifndef SKIP_CONSTANT_MAX_PATH
  CONSTANT_UNSIGNED(MAX_PATH)
#endif
#ifndef SKIP_CONSTANT_PATH_MAX_WIDE
  CONSTANT_UNSIGNED(PATH_MAX_WIDE)
#endif
#ifndef SKIP_CONSTANT_FILE_BEGIN
  CONSTANT_UNSIGNED(FILE_BEGIN)
#endif
#ifndef SKIP_CONSTANT_FILE_END
  CONSTANT_UNSIGNED(FILE_END)
#endif
#ifndef SKIP_CONSTANT_DUPLICATE_SAME_ACCESS
  CONSTANT_UNSIGNED(DUPLICATE_SAME_ACCESS)
#endif
#ifndef SKIP_CONSTANT_FILE_SHARE_READ
  CONSTANT_UNSIGNED(FILE_SHARE_READ)
#endif
#ifndef SKIP_CONSTANT_FILE_SHARE_WRITE
  CONSTANT_UNSIGNED(FILE_SHARE_WRITE)
#endif
#ifndef SKIP_CONSTANT_FILE_SHARE_DELETE
  CONSTANT_UNSIGNED(FILE_SHARE_DELETE)
#endif
#ifndef SKIP_CONSTANT_FILE_ATTRIBUTE_READONLY
  CONSTANT_UNSIGNED(FILE_ATTRIBUTE_READONLY)
#endif
#ifndef SKIP_CONSTANT_FILE_ATTRIBUTE_HIDDEN
  CONSTANT_UNSIGNED(FILE_ATTRIBUTE_HIDDEN)
#endif
#ifndef SKIP_CONSTANT_FILE_ATTRIBUTE_DIRECTORY
  CONSTANT_UNSIGNED(FILE_ATTRIBUTE_DIRECTORY)
#endif
#ifndef SKIP_CONSTANT_FILE_ATTRIBUTE_NORMAL
  CONSTANT_UNSIGNED(FILE_ATTRIBUTE_NORMAL)
#endif
#ifndef SKIP_CONSTANT_FILE_ATTRIBUTE_TEMPORARY
  CONSTANT_UNSIGNED(FILE_ATTRIBUTE_TEMPORARY)
#endif
#ifndef SKIP_CONSTANT_FILE_ATTRIBUTE_REPARSE_POINT
  CONSTANT_UNSIGNED(FILE_ATTRIBUTE_REPARSE_POINT)
#endif
#ifndef SKIP_CONSTANT_FILE_OPEN
  CONSTANT_UNSIGNED(FILE_OPEN)
#endif
#ifndef SKIP_CONSTANT_FILE_CREATE
  CONSTANT_UNSIGNED(FILE_CREATE)
#endif
#ifndef SKIP_CONSTANT_FILE_OPEN_IF
  CONSTANT_UNSIGNED(FILE_OPEN_IF)
#endif
#ifndef SKIP_CONSTANT_FILE_OVERWRITE
  CONSTANT_UNSIGNED(FILE_OVERWRITE)
#endif
#ifndef SKIP_CONSTANT_FILE_OVERWRITE_IF
  CONSTANT_UNSIGNED(FILE_OVERWRITE_IF)
#endif
#ifndef SKIP_CONSTANT_FILE_DIRECTORY_FILE
  CONSTANT_UNSIGNED(FILE_DIRECTORY_FILE)
#endif
#ifndef SKIP_CONSTANT_FILE_SYNCHRONOUS_IO_NONALERT
  CONSTANT_UNSIGNED(FILE_SYNCHRONOUS_IO_NONALERT)
#endif
#ifndef SKIP_CONSTANT_FILE_NON_DIRECTORY_FILE
  CONSTANT_UNSIGNED(FILE_NON_DIRECTORY_FILE)
#endif
#ifndef SKIP_CONSTANT_FILE_OPEN_REPARSE_POINT
  CONSTANT_UNSIGNED(FILE_OPEN_REPARSE_POINT)
#endif
#ifndef SKIP_CONSTANT_OPEN_EXISTING
  CONSTANT_UNSIGNED(OPEN_EXISTING)
#endif
#ifndef SKIP_CONSTANT_FILE_FLAG_BACKUP_SEMANTICS
  CONSTANT_UNSIGNED(FILE_FLAG_BACKUP_SEMANTICS)
#endif
#ifndef SKIP_CONSTANT_FILE_FLAG_OVERLAPPED
  CONSTANT_UNSIGNED(FILE_FLAG_OVERLAPPED)
#endif
#ifndef SKIP_CONSTANT_PIPE_ACCESS_INBOUND
  CONSTANT_UNSIGNED(PIPE_ACCESS_INBOUND)
#endif
#ifndef SKIP_CONSTANT_PIPE_ACCESS_OUTBOUND
  CONSTANT_UNSIGNED(PIPE_ACCESS_OUTBOUND)
#endif
#ifndef SKIP_CONSTANT_PIPE_TYPE_BYTE
  CONSTANT_UNSIGNED(PIPE_TYPE_BYTE)
#endif
#ifndef SKIP_CONSTANT_PIPE_READMODE_BYTE
  CONSTANT_UNSIGNED(PIPE_READMODE_BYTE)
#endif
#ifndef SKIP_CONSTANT_PIPE_WAIT
  CONSTANT_UNSIGNED(PIPE_WAIT)
#endif
#ifndef SKIP_CONSTANT_SYMBOLIC_LINK_FLAG_DIRECTORY
  CONSTANT_UNSIGNED(SYMBOLIC_LINK_FLAG_DIRECTORY)
#endif
#ifndef SKIP_CONSTANT_SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE
  CONSTANT_UNSIGNED(SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE)
#endif
#ifndef SKIP_CONSTANT_FILE_DEVICE_NAMED_PIPE
  CONSTANT_UNSIGNED(FILE_DEVICE_NAMED_PIPE)
#endif
#ifndef SKIP_CONSTANT_FILE_DEVICE_NULL
  CONSTANT_UNSIGNED(FILE_DEVICE_NULL)
#endif
#ifndef SKIP_CONSTANT_FILE_DEVICE_CONSOLE
  CONSTANT_UNSIGNED(FILE_DEVICE_CONSOLE)
#endif
#ifndef SKIP_CONSTANT_FILE_RENAME_REPLACE_IF_EXISTS
  CONSTANT_UNSIGNED(FILE_RENAME_REPLACE_IF_EXISTS)
#endif
#ifndef SKIP_CONSTANT_FILE_RENAME_POSIX_SEMANTICS
  CONSTANT_UNSIGNED(FILE_RENAME_POSIX_SEMANTICS)
#endif
#ifndef SKIP_CONSTANT_FILE_RENAME_IGNORE_READONLY_ATTRIBUTE
  CONSTANT_UNSIGNED(FILE_RENAME_IGNORE_READONLY_ATTRIBUTE)
#endif
#ifndef SKIP_CONSTANT_FILE_NAME_NORMALIZED
  CONSTANT_UNSIGNED(FILE_NAME_NORMALIZED)
#endif
#ifndef SKIP_CONSTANT_VOLUME_NAME_DOS
  CONSTANT_UNSIGNED(VOLUME_NAME_DOS)
#endif
#ifndef SKIP_CONSTANT_VOLUME_NAME_GUID
  CONSTANT_UNSIGNED(VOLUME_NAME_GUID)
#endif
#ifndef SKIP_CONSTANT_VOLUME_NAME_NT
  CONSTANT_UNSIGNED(VOLUME_NAME_NT)
#endif
#ifndef SKIP_CONSTANT_VOLUME_NAME_NONE
  CONSTANT_UNSIGNED(VOLUME_NAME_NONE)
#endif
#ifndef SKIP_CONSTANT_UNW_FLAG_NHANDLER
  CONSTANT_UNSIGNED(UNW_FLAG_NHANDLER)
#endif
#ifndef SKIP_CONSTANT_MEM_COMMIT
  CONSTANT_UNSIGNED(MEM_COMMIT)
#endif
#ifndef SKIP_CONSTANT_PAGE_NOACCESS
  CONSTANT_UNSIGNED(PAGE_NOACCESS)
#endif
#ifndef SKIP_CONSTANT_PAGE_READONLY
  CONSTANT_UNSIGNED(PAGE_READONLY)
#endif
#ifndef SKIP_CONSTANT_PAGE_READWRITE
  CONSTANT_UNSIGNED(PAGE_READWRITE)
#endif
#ifndef SKIP_CONSTANT_PAGE_WRITECOPY
  CONSTANT_UNSIGNED(PAGE_WRITECOPY)
#endif
#ifndef SKIP_CONSTANT_PAGE_EXECUTE_READ
  CONSTANT_UNSIGNED(PAGE_EXECUTE_READ)
#endif
#ifndef SKIP_CONSTANT_PAGE_EXECUTE_READWRITE
  CONSTANT_UNSIGNED(PAGE_EXECUTE_READWRITE)
#endif
#ifndef SKIP_CONSTANT_PAGE_EXECUTE_WRITECOPY
  CONSTANT_UNSIGNED(PAGE_EXECUTE_WRITECOPY)
#endif
#ifndef SKIP_CONSTANT_PAGE_GUARD
  CONSTANT_UNSIGNED(PAGE_GUARD)
#endif
#ifndef SKIP_CONSTANT_INFINITE
  CONSTANT_UNSIGNED(INFINITE)
#endif
#ifndef SKIP_CONSTANT_WAIT_FAILED
  CONSTANT_UNSIGNED(WAIT_FAILED)
#endif
#ifndef SKIP_CONSTANT_STARTF_USESTDHANDLES
  CONSTANT_UNSIGNED(STARTF_USESTDHANDLES)
#endif
#ifndef SKIP_CONSTANT_AF_UNSPEC
  CONSTANT_SIGNED(AF_UNSPEC)
#endif
#ifndef SKIP_CONSTANT_AF_UNIX
  CONSTANT_SIGNED(AF_UNIX)
#endif
#ifndef SKIP_CONSTANT_AF_INET
  CONSTANT_SIGNED(AF_INET)
#endif
#ifndef SKIP_CONSTANT_AF_INET6
  CONSTANT_SIGNED(AF_INET6)
#endif
#ifndef SKIP_CONSTANT_SOCK_STREAM
  CONSTANT_SIGNED(SOCK_STREAM)
#endif
#ifndef SKIP_CONSTANT_SOCK_DGRAM
  CONSTANT_SIGNED(SOCK_DGRAM)
#endif
#ifndef SKIP_CONSTANT_IPPROTO_TCP
  CONSTANT_SIGNED(IPPROTO_TCP)
#endif
#ifndef SKIP_CONSTANT_IPPROTO_UDP
  CONSTANT_SIGNED(IPPROTO_UDP)
#endif
#ifndef SKIP_CONSTANT_SOCKET_ERROR
  CONSTANT_SIGNED(SOCKET_ERROR)
#endif
#ifndef SKIP_CONSTANT_POLLWRNORM
  CONSTANT_SIGNED(POLLWRNORM)
#endif
#ifndef SKIP_CONSTANT_TOKEN_QUERY
  CONSTANT_UNSIGNED(TOKEN_QUERY)
#endif
#ifndef SKIP_CONSTANT_TOKEN_IS_APP_CONTAINER
  CONSTANT_SIGNED(TOKEN_IS_APP_CONTAINER)
#endif
#ifndef SKIP_CONSTANT_JobObjectAssociateCompletionPortInformation
  CONSTANT_UNSIGNED(JobObjectAssociateCompletionPortInformation)
#endif
#ifndef SKIP_CONSTANT_JobObjectExtendedLimitInformation
  CONSTANT_UNSIGNED(JobObjectExtendedLimitInformation)
#endif
#ifndef SKIP_CONSTANT_WT_EXECUTEONLYONCE
  CONSTANT_UNSIGNED(WT_EXECUTEONLYONCE)
#endif
#ifndef SKIP_CONSTANT_ProcessBasicInformation
  CONSTANT_UNSIGNED(ProcessBasicInformation)
#endif
#ifndef SKIP_CONSTANT_CTRL_C_EVENT
  CONSTANT_UNSIGNED(CTRL_C_EVENT)
#endif
#ifndef SKIP_CONSTANT_CTRL_BREAK_EVENT
  CONSTANT_UNSIGNED(CTRL_BREAK_EVENT)
#endif
#ifndef SKIP_CONSTANT_CTRL_CLOSE_EVENT
  CONSTANT_UNSIGNED(CTRL_CLOSE_EVENT)
#endif
#ifndef SKIP_CONSTANT_UV_HANDLE_TYPE_MAX
  CONSTANT_SIGNED(UV_HANDLE_TYPE_MAX)
#endif
#ifndef SKIP_CONSTANT_CREAT
  CONSTANT_SIGNED(CREAT)
#endif
#ifndef SKIP_CONSTANT_RANDOM
  CONSTANT_SIGNED(RANDOM)
#endif
#ifndef SKIP_CONSTANT_RDONLY
  CONSTANT_SIGNED(RDONLY)
#endif
#ifndef SKIP_CONSTANT_RDWR
  CONSTANT_SIGNED(RDWR)
#endif
#ifndef SKIP_CONSTANT_SEQUENTIAL
  CONSTANT_SIGNED(SEQUENTIAL)
#endif
#ifndef SKIP_CONSTANT_SHORT_LIVED
  CONSTANT_SIGNED(SHORT_LIVED)
#endif
#ifndef SKIP_CONSTANT_TEMPORARY
  CONSTANT_SIGNED(TEMPORARY)
#endif
#ifndef SKIP_CONSTANT_TRUNC
  CONSTANT_SIGNED(TRUNC)
#endif
#ifndef SKIP_CONSTANT_WRONLY
  CONSTANT_SIGNED(WRONLY)
#endif
#ifndef SKIP_CONSTANT_DIRECTORY
  CONSTANT_SIGNED(DIRECTORY)
#endif
#ifndef SKIP_CONSTANT_EXLOCK
  CONSTANT_SIGNED(EXLOCK)
#endif
#ifndef SKIP_CONSTANT_NOATIME
  CONSTANT_SIGNED(NOATIME)
#endif
#ifndef SKIP_CONSTANT_NOCTTY
  CONSTANT_SIGNED(NOCTTY)
#endif
#ifndef SKIP_CONSTANT_NONBLOCK
  CONSTANT_SIGNED(NONBLOCK)
#endif
#ifndef SKIP_CONSTANT_SYMLINK
  CONSTANT_SIGNED(SYMLINK)
#endif
#ifndef SKIP_CONSTANT_UV__EOF
  CONSTANT_SIGNED(UV__EOF)
#endif
#ifndef SKIP_CONSTANT_UV__UNKNOWN
  CONSTANT_SIGNED(UV__UNKNOWN)
#endif
#ifndef SKIP_CONSTANT_UV__ECHARSET
  CONSTANT_SIGNED(UV__ECHARSET)
#endif
#ifndef SKIP_CONSTANT_UV_E2BIG
  CONSTANT_SIGNED(UV_E2BIG)
#endif
#ifndef SKIP_CONSTANT_UV_EACCES
  CONSTANT_SIGNED(UV_EACCES)
#endif
#ifndef SKIP_CONSTANT_UV_EADDRINUSE
  CONSTANT_SIGNED(UV_EADDRINUSE)
#endif
#ifndef SKIP_CONSTANT_UV_EADDRNOTAVAIL
  CONSTANT_SIGNED(UV_EADDRNOTAVAIL)
#endif
#ifndef SKIP_CONSTANT_UV_EAFNOSUPPORT
  CONSTANT_SIGNED(UV_EAFNOSUPPORT)
#endif
#ifndef SKIP_CONSTANT_UV_EAGAIN
  CONSTANT_SIGNED(UV_EAGAIN)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_ADDRFAMILY
  CONSTANT_SIGNED(UV_EAI_ADDRFAMILY)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_AGAIN
  CONSTANT_SIGNED(UV_EAI_AGAIN)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_BADFLAGS
  CONSTANT_SIGNED(UV_EAI_BADFLAGS)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_BADHINTS
  CONSTANT_SIGNED(UV_EAI_BADHINTS)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_CANCELED
  CONSTANT_SIGNED(UV_EAI_CANCELED)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_FAIL
  CONSTANT_SIGNED(UV_EAI_FAIL)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_FAMILY
  CONSTANT_SIGNED(UV_EAI_FAMILY)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_MEMORY
  CONSTANT_SIGNED(UV_EAI_MEMORY)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_NODATA
  CONSTANT_SIGNED(UV_EAI_NODATA)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_NONAME
  CONSTANT_SIGNED(UV_EAI_NONAME)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_OVERFLOW
  CONSTANT_SIGNED(UV_EAI_OVERFLOW)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_PROTOCOL
  CONSTANT_SIGNED(UV_EAI_PROTOCOL)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_SERVICE
  CONSTANT_SIGNED(UV_EAI_SERVICE)
#endif
#ifndef SKIP_CONSTANT_UV_EAI_SOCKTYPE
  CONSTANT_SIGNED(UV_EAI_SOCKTYPE)
#endif
#ifndef SKIP_CONSTANT_UV_EALREADY
  CONSTANT_SIGNED(UV_EALREADY)
#endif
#ifndef SKIP_CONSTANT_UV_EBADF
  CONSTANT_SIGNED(UV_EBADF)
#endif
#ifndef SKIP_CONSTANT_UV_EBUSY
  CONSTANT_SIGNED(UV_EBUSY)
#endif
#ifndef SKIP_CONSTANT_UV_ECANCELED
  CONSTANT_SIGNED(UV_ECANCELED)
#endif
#ifndef SKIP_CONSTANT_UV_ECHARSET
  CONSTANT_SIGNED(UV_ECHARSET)
#endif
#ifndef SKIP_CONSTANT_UV_ECONNABORTED
  CONSTANT_SIGNED(UV_ECONNABORTED)
#endif
#ifndef SKIP_CONSTANT_UV_ECONNREFUSED
  CONSTANT_SIGNED(UV_ECONNREFUSED)
#endif
#ifndef SKIP_CONSTANT_UV_ECONNRESET
  CONSTANT_SIGNED(UV_ECONNRESET)
#endif
#ifndef SKIP_CONSTANT_UV_EDESTADDRREQ
  CONSTANT_SIGNED(UV_EDESTADDRREQ)
#endif
#ifndef SKIP_CONSTANT_UV_EEXIST
  CONSTANT_SIGNED(UV_EEXIST)
#endif
#ifndef SKIP_CONSTANT_UV_EFAULT
  CONSTANT_SIGNED(UV_EFAULT)
#endif
#ifndef SKIP_CONSTANT_UV_EFBIG
  CONSTANT_SIGNED(UV_EFBIG)
#endif
#ifndef SKIP_CONSTANT_UV_EHOSTUNREACH
  CONSTANT_SIGNED(UV_EHOSTUNREACH)
#endif
#ifndef SKIP_CONSTANT_UV_EINTR
  CONSTANT_SIGNED(UV_EINTR)
#endif
#ifndef SKIP_CONSTANT_UV_EINVAL
  CONSTANT_SIGNED(UV_EINVAL)
#endif
#ifndef SKIP_CONSTANT_UV_EIO
  CONSTANT_SIGNED(UV_EIO)
#endif
#ifndef SKIP_CONSTANT_UV_EISCONN
  CONSTANT_SIGNED(UV_EISCONN)
#endif
#ifndef SKIP_CONSTANT_UV_EISDIR
  CONSTANT_SIGNED(UV_EISDIR)
#endif
#ifndef SKIP_CONSTANT_UV_ELOOP
  CONSTANT_SIGNED(UV_ELOOP)
#endif
#ifndef SKIP_CONSTANT_UV_EMFILE
  CONSTANT_SIGNED(UV_EMFILE)
#endif
#ifndef SKIP_CONSTANT_UV_EMSGSIZE
  CONSTANT_SIGNED(UV_EMSGSIZE)
#endif
#ifndef SKIP_CONSTANT_UV_ENAMETOOLONG
  CONSTANT_SIGNED(UV_ENAMETOOLONG)
#endif
#ifndef SKIP_CONSTANT_UV_ENETDOWN
  CONSTANT_SIGNED(UV_ENETDOWN)
#endif
#ifndef SKIP_CONSTANT_UV_ENETUNREACH
  CONSTANT_SIGNED(UV_ENETUNREACH)
#endif
#ifndef SKIP_CONSTANT_UV_ENFILE
  CONSTANT_SIGNED(UV_ENFILE)
#endif
#ifndef SKIP_CONSTANT_UV_ENOBUFS
  CONSTANT_SIGNED(UV_ENOBUFS)
#endif
#ifndef SKIP_CONSTANT_UV_ENODEV
  CONSTANT_SIGNED(UV_ENODEV)
#endif
#ifndef SKIP_CONSTANT_UV_ENOENT
  CONSTANT_SIGNED(UV_ENOENT)
#endif
#ifndef SKIP_CONSTANT_UV_ENOMEM
  CONSTANT_SIGNED(UV_ENOMEM)
#endif
#ifndef SKIP_CONSTANT_UV_ENONET
  CONSTANT_SIGNED(UV_ENONET)
#endif
#ifndef SKIP_CONSTANT_UV_ENOPROTOOPT
  CONSTANT_SIGNED(UV_ENOPROTOOPT)
#endif
#ifndef SKIP_CONSTANT_UV_ENOSPC
  CONSTANT_SIGNED(UV_ENOSPC)
#endif
#ifndef SKIP_CONSTANT_UV_ENOSYS
  CONSTANT_SIGNED(UV_ENOSYS)
#endif
#ifndef SKIP_CONSTANT_UV_ENOTCONN
  CONSTANT_SIGNED(UV_ENOTCONN)
#endif
#ifndef SKIP_CONSTANT_UV_ENOTDIR
  CONSTANT_SIGNED(UV_ENOTDIR)
#endif
#ifndef SKIP_CONSTANT_UV_ENOTEMPTY
  CONSTANT_SIGNED(UV_ENOTEMPTY)
#endif
#ifndef SKIP_CONSTANT_UV_ENOTSOCK
  CONSTANT_SIGNED(UV_ENOTSOCK)
#endif
#ifndef SKIP_CONSTANT_UV_ENOTSUP
  CONSTANT_SIGNED(UV_ENOTSUP)
#endif
#ifndef SKIP_CONSTANT_UV_EOVERFLOW
  CONSTANT_SIGNED(UV_EOVERFLOW)
#endif
#ifndef SKIP_CONSTANT_UV_EPERM
  CONSTANT_SIGNED(UV_EPERM)
#endif
#ifndef SKIP_CONSTANT_UV_EPIPE
  CONSTANT_SIGNED(UV_EPIPE)
#endif
#ifndef SKIP_CONSTANT_UV_EPROTO
  CONSTANT_SIGNED(UV_EPROTO)
#endif
#ifndef SKIP_CONSTANT_UV_EPROTONOSUPPORT
  CONSTANT_SIGNED(UV_EPROTONOSUPPORT)
#endif
#ifndef SKIP_CONSTANT_UV_EPROTOTYPE
  CONSTANT_SIGNED(UV_EPROTOTYPE)
#endif
#ifndef SKIP_CONSTANT_UV_ERANGE
  CONSTANT_SIGNED(UV_ERANGE)
#endif
#ifndef SKIP_CONSTANT_UV_EROFS
  CONSTANT_SIGNED(UV_EROFS)
#endif
#ifndef SKIP_CONSTANT_UV_ESHUTDOWN
  CONSTANT_SIGNED(UV_ESHUTDOWN)
#endif
#ifndef SKIP_CONSTANT_UV_ESPIPE
  CONSTANT_SIGNED(UV_ESPIPE)
#endif
#ifndef SKIP_CONSTANT_UV_ESRCH
  CONSTANT_SIGNED(UV_ESRCH)
#endif
#ifndef SKIP_CONSTANT_UV_ETIMEDOUT
  CONSTANT_SIGNED(UV_ETIMEDOUT)
#endif
#ifndef SKIP_CONSTANT_UV_ETXTBSY
  CONSTANT_SIGNED(UV_ETXTBSY)
#endif
#ifndef SKIP_CONSTANT_UV_EXDEV
  CONSTANT_SIGNED(UV_EXDEV)
#endif
#ifndef SKIP_CONSTANT_UV_UNKNOWN
  CONSTANT_SIGNED(UV_UNKNOWN)
#endif
#ifndef SKIP_CONSTANT_UV_EOF
  CONSTANT_SIGNED(UV_EOF)
#endif
#ifndef SKIP_CONSTANT_UV_ENXIO
  CONSTANT_SIGNED(UV_ENXIO)
#endif
#ifndef SKIP_CONSTANT_UV_EMLINK
  CONSTANT_SIGNED(UV_EMLINK)
#endif
#ifndef SKIP_CONSTANT_UV_EHOSTDOWN
  CONSTANT_SIGNED(UV_EHOSTDOWN)
#endif
#ifndef SKIP_CONSTANT_UV_EREMOTEIO
  CONSTANT_SIGNED(UV_EREMOTEIO)
#endif
#ifndef SKIP_CONSTANT_UV_ENOTTY
  CONSTANT_SIGNED(UV_ENOTTY)
#endif
#ifndef SKIP_CONSTANT_UV_EFTYPE
  CONSTANT_SIGNED(UV_EFTYPE)
#endif
#ifndef SKIP_CONSTANT_UV_EILSEQ
  CONSTANT_SIGNED(UV_EILSEQ)
#endif
#ifndef SKIP_CONSTANT_UV_ESOCKTNOSUPPORT
  CONSTANT_SIGNED(UV_ESOCKTNOSUPPORT)
#endif
#ifndef SKIP_CONSTANT_UV_ENODATA
  CONSTANT_SIGNED(UV_ENODATA)
#endif
#ifndef SKIP_CONSTANT_UV_EUNATCH
  CONSTANT_SIGNED(UV_EUNATCH)
#endif
#ifndef SKIP_CONSTANT_UV_ENOEXEC
  CONSTANT_SIGNED(UV_ENOEXEC)
#endif
#ifndef SKIP_CONSTANT_UV_ERRNO_MAX
  CONSTANT_SIGNED(UV_ERRNO_MAX)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_UNKNOWN
  CONSTANT_SIGNED(UV_DIRENT_UNKNOWN)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_FILE
  CONSTANT_SIGNED(UV_DIRENT_FILE)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_DIR
  CONSTANT_SIGNED(UV_DIRENT_DIR)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_LINK
  CONSTANT_SIGNED(UV_DIRENT_LINK)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_FIFO
  CONSTANT_SIGNED(UV_DIRENT_FIFO)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_SOCKET
  CONSTANT_SIGNED(UV_DIRENT_SOCKET)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_CHAR
  CONSTANT_SIGNED(UV_DIRENT_CHAR)
#endif
#ifndef SKIP_CONSTANT_UV_DIRENT_BLOCK
  CONSTANT_SIGNED(UV_DIRENT_BLOCK)
#endif
#ifndef SKIP_CONSTANT_UV_READABLE
  CONSTANT_SIGNED(UV_READABLE)
#endif
#ifndef SKIP_CONSTANT_UV_WRITABLE
  CONSTANT_SIGNED(UV_WRITABLE)
#endif
#ifndef SKIP_CONSTANT_UV_DISCONNECT
  CONSTANT_SIGNED(UV_DISCONNECT)
#endif
#ifndef SKIP_CONSTANT_UV_PRIORITIZED
  CONSTANT_SIGNED(UV_PRIORITIZED)
#endif
#ifndef SKIP_CONSTANT_UV_FS_SYMLINK_DIR
  CONSTANT_SIGNED(UV_FS_SYMLINK_DIR)
#endif
#ifndef SKIP_CONSTANT_UV_FS_SYMLINK_JUNCTION
  CONSTANT_SIGNED(UV_FS_SYMLINK_JUNCTION)
#endif
#ifndef SKIP_CONSTANT_UV_RENAME
  CONSTANT_SIGNED(UV_RENAME)
#endif
#ifndef SKIP_CONSTANT_UV_CHANGE
  CONSTANT_SIGNED(UV_CHANGE)
#endif
#ifndef SKIP_CONSTANT_UV_FS_EVENT_WATCH_ENTRY
  CONSTANT_SIGNED(UV_FS_EVENT_WATCH_ENTRY)
#endif
#ifndef SKIP_CONSTANT_UV_FS_EVENT_STAT
  CONSTANT_SIGNED(UV_FS_EVENT_STAT)
#endif
#ifndef SKIP_CONSTANT_UV_FS_EVENT_RECURSIVE
  CONSTANT_SIGNED(UV_FS_EVENT_RECURSIVE)
#endif
#ifndef SKIP_CONSTANT_UV_IGNORE
  CONSTANT_UNSIGNED(UV_IGNORE)
#endif
#ifndef SKIP_CONSTANT_UV_CREATE_PIPE
  CONSTANT_UNSIGNED(UV_CREATE_PIPE)
#endif
#ifndef SKIP_CONSTANT_UV_INHERIT_FD
  CONSTANT_UNSIGNED(UV_INHERIT_FD)
#endif
#ifndef SKIP_CONSTANT_UV_INHERIT_STREAM
  CONSTANT_UNSIGNED(UV_INHERIT_STREAM)
#endif
#ifndef SKIP_CONSTANT_UV_READABLE_PIPE
  CONSTANT_UNSIGNED(UV_READABLE_PIPE)
#endif
#ifndef SKIP_CONSTANT_UV_WRITABLE_PIPE
  CONSTANT_UNSIGNED(UV_WRITABLE_PIPE)
#endif
#ifndef SKIP_CONSTANT_UV_NONBLOCK_PIPE
  CONSTANT_UNSIGNED(UV_NONBLOCK_PIPE)
#endif
#ifndef SKIP_CONSTANT_UV_OVERLAPPED_PIPE
  CONSTANT_UNSIGNED(UV_OVERLAPPED_PIPE)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_SETUID
  CONSTANT_UNSIGNED(UV_PROCESS_SETUID)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_SETGID
  CONSTANT_UNSIGNED(UV_PROCESS_SETGID)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS
  CONSTANT_UNSIGNED(UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_DETACHED
  CONSTANT_UNSIGNED(UV_PROCESS_DETACHED)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_WINDOWS_HIDE
  CONSTANT_UNSIGNED(UV_PROCESS_WINDOWS_HIDE)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_WINDOWS_HIDE_CONSOLE
  CONSTANT_UNSIGNED(UV_PROCESS_WINDOWS_HIDE_CONSOLE)
#endif
#ifndef SKIP_CONSTANT_UV_PROCESS_WINDOWS_HIDE_GUI
  CONSTANT_UNSIGNED(UV_PROCESS_WINDOWS_HIDE_GUI)
#endif
#ifndef SKIP_CONSTANT_SIGHUP
  CONSTANT_SIGNED(SIGHUP)
#endif
#ifndef SKIP_CONSTANT_SIGQUIT
  CONSTANT_SIGNED(SIGQUIT)
#endif
#ifndef SKIP_CONSTANT_SIGKILL
  CONSTANT_SIGNED(SIGKILL)
#endif
#ifndef SKIP_CONSTANT_SIGWINCH
  CONSTANT_SIGNED(SIGWINCH)
#endif
#ifndef SKIP_CONSTANT_ENABLE_VIRTUAL_TERMINAL_PROCESSING
  CONSTANT_UNSIGNED(ENABLE_VIRTUAL_TERMINAL_PROCESSING)
#endif
#ifndef SKIP_CONSTANT_MOVEFILE_COPY_ALLOWED
  CONSTANT_UNSIGNED(MOVEFILE_COPY_ALLOWED)
#endif
#ifndef SKIP_CONSTANT_MOVEFILE_REPLACE_EXISTING
  CONSTANT_UNSIGNED(MOVEFILE_REPLACE_EXISTING)
#endif
#ifndef SKIP_CONSTANT_MOVEFILE_WRITE_THROUGH
  CONSTANT_UNSIGNED(MOVEFILE_WRITE_THROUGH)
#endif
#ifndef SKIP_CONSTANT_INVALID_FILE_ATTRIBUTES
  CONSTANT_UNSIGNED(INVALID_FILE_ATTRIBUTES)
#endif
#ifndef SKIP_CONSTANT_S_OK
  CONSTANT_SIGNED(S_OK)
#endif
#ifndef SKIP_CONSTANT_FILE_LIST_DIRECTORY
  CONSTANT_UNSIGNED(FILE_LIST_DIRECTORY)
#endif
#ifndef SKIP_CONSTANT_FILE_OPEN_FOR_BACKUP_INTENT
  CONSTANT_UNSIGNED(FILE_OPEN_FOR_BACKUP_INTENT)
#endif
#ifndef SKIP_CONSTANT_FILE_ACTION_ADDED
  CONSTANT_UNSIGNED(FILE_ACTION_ADDED)
#endif
#ifndef SKIP_CONSTANT_FILE_ACTION_REMOVED
  CONSTANT_UNSIGNED(FILE_ACTION_REMOVED)
#endif
#ifndef SKIP_CONSTANT_FILE_ACTION_MODIFIED
  CONSTANT_UNSIGNED(FILE_ACTION_MODIFIED)
#endif
#ifndef SKIP_CONSTANT_FILE_ACTION_RENAMED_OLD_NAME
  CONSTANT_UNSIGNED(FILE_ACTION_RENAMED_OLD_NAME)
#endif
#ifndef SKIP_CONSTANT_FILE_ACTION_RENAMED_NEW_NAME
  CONSTANT_UNSIGNED(FILE_ACTION_RENAMED_NEW_NAME)
#endif
#ifndef SKIP_CONSTANT_FILE_TYPE_CHAR
  CONSTANT_UNSIGNED(FILE_TYPE_CHAR)
#endif
#ifndef SKIP_CONSTANT_FILE_TYPE_PIPE
  CONSTANT_UNSIGNED(FILE_TYPE_PIPE)
#endif
#ifndef SKIP_CONSTANT_PROCESS_QUERY_LIMITED_INFORMATION
  CONSTANT_UNSIGNED(PROCESS_QUERY_LIMITED_INFORMATION)
#endif
#ifndef SKIP_CONSTANT_ENABLE_ECHO_INPUT
  CONSTANT_UNSIGNED(ENABLE_ECHO_INPUT)
#endif
#ifndef SKIP_CONSTANT_ENABLE_LINE_INPUT
  CONSTANT_UNSIGNED(ENABLE_LINE_INPUT)
#endif
#ifndef SKIP_CONSTANT_ENABLE_PROCESSED_INPUT
  CONSTANT_UNSIGNED(ENABLE_PROCESSED_INPUT)
#endif
#ifndef SKIP_CONSTANT_ENABLE_VIRTUAL_TERMINAL_INPUT
  CONSTANT_UNSIGNED(ENABLE_VIRTUAL_TERMINAL_INPUT)
#endif
#ifndef SKIP_CONSTANT_ENABLE_WRAP_AT_EOL_OUTPUT
  CONSTANT_UNSIGNED(ENABLE_WRAP_AT_EOL_OUTPUT)
#endif
#ifndef SKIP_CONSTANT_ENABLE_PROCESSED_OUTPUT
  CONSTANT_UNSIGNED(ENABLE_PROCESSED_OUTPUT)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_CONTINUE_EXECUTION
  CONSTANT_SIGNED(EXCEPTION_CONTINUE_EXECUTION)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_CONTINUE_SEARCH
  CONSTANT_SIGNED(EXCEPTION_CONTINUE_SEARCH)
#endif
#ifndef SKIP_CONSTANT_MS_VC_EXCEPTION
  CONSTANT_UNSIGNED(MS_VC_EXCEPTION)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_UNWIND
  CONSTANT_UNSIGNED(EXCEPTION_UNWIND)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_ACCESS_VIOLATION
  CONSTANT_UNSIGNED(EXCEPTION_ACCESS_VIOLATION)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_DATATYPE_MISALIGNMENT
  CONSTANT_UNSIGNED(EXCEPTION_DATATYPE_MISALIGNMENT)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_ILLEGAL_INSTRUCTION
  CONSTANT_UNSIGNED(EXCEPTION_ILLEGAL_INSTRUCTION)
#endif
#ifndef SKIP_CONSTANT_EXCEPTION_STACK_OVERFLOW
  CONSTANT_UNSIGNED(EXCEPTION_STACK_OVERFLOW)
#endif
#ifndef SKIP_CONSTANT_STATUS_CONTROL_C_EXIT
  CONSTANT_UNSIGNED(STATUS_CONTROL_C_EXIT)
#endif
#ifndef SKIP_CONSTANT_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  CONSTANT_UNSIGNED(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
#endif
#ifndef SKIP_CONSTANT_JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE
  CONSTANT_UNSIGNED(JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE)
#endif
  printf("\n}}\n");
  return 0;
}
