
#include <ntstatus.h>
#include <stdio.h>
#include <windows.h>
#include <winternl.h>

typedef struct _FILE_DIRECTORY_INFORMATION {
  ULONG NextEntryOffset;
  ULONG FileIndex;
  LARGE_INTEGER CreationTime;
  LARGE_INTEGER LastAccessTime;
  LARGE_INTEGER LastWriteTime;
  LARGE_INTEGER ChangeTime;
  LARGE_INTEGER EndOfFile;
  LARGE_INTEGER AllocationSize;
  ULONG FileAttributes;
  ULONG FileNameLength;
  WCHAR FileName[1];
} FILE_DIRECTORY_INFORMATION, *PFILE_DIRECTORY_INFORMATION;

typedef struct _FILE_BOTH_DIR_INFORMATION {
  ULONG NextEntryOffset;
  ULONG FileIndex;
  LARGE_INTEGER CreationTime;
  LARGE_INTEGER LastAccessTime;
  LARGE_INTEGER LastWriteTime;
  LARGE_INTEGER ChangeTime;
  LARGE_INTEGER EndOfFile;
  LARGE_INTEGER AllocationSize;
  ULONG FileAttributes;
  ULONG FileNameLength;
  ULONG EaSize;
  CHAR ShortNameLength;
  WCHAR ShortName[12];
  WCHAR FileName[1];
} FILE_BOTH_DIR_INFORMATION, *PFILE_BOTH_DIR_INFORMATION;

int main_using_file_directory_information(int argc, char *argv[]) {
  if (argc != 2) {
    printf("Usage: ntquery <filename>\n");
    return 1;
  }

  auto *NtQueryDirectoryFile = (NTSTATUS(WINAPI *)(
      HANDLE, HANDLE, PVOID, PVOID, PVOID, PVOID, DWORD, FILE_INFORMATION_CLASS,
      BOOLEAN, PVOID, BOOLEAN))GetProcAddress(GetModuleHandle("ntdll.dll"),
                                              "NtQueryDirectoryFile");

  if (NtQueryDirectoryFile == NULL) {
    printf("Error getting NtQueryDirectoryFile\n");
    return 1;
  }

  // open the current working directory using NT API
  HANDLE hFile = CreateFile(argv[1], GENERIC_READ, FILE_SHARE_READ, NULL,
                            OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);

  // use NtQueryDirectoryFile
  char buffer[64096];

  IO_STATUS_BLOCK ioStatusBlock;
  NTSTATUS status = NtQueryDirectoryFile(
      hFile, NULL, NULL, NULL, &ioStatusBlock, buffer, sizeof(buffer),
      FileDirectoryInformation, FALSE, NULL, FALSE);
  if (status != STATUS_SUCCESS) {
    printf("Error querying directory\n");
    return 1;
  }

  PFILE_DIRECTORY_INFORMATION pDirInfo = (PFILE_DIRECTORY_INFORMATION)buffer;
  while (TRUE) {
    printf("%S\n", pDirInfo->FileName);
    if (pDirInfo->NextEntryOffset == 0) {
      // if no more entries, continue to next query directory call
      status = NtQueryDirectoryFile(
          hFile, NULL, NULL, NULL, &ioStatusBlock, buffer, sizeof(buffer),
          FileDirectoryInformation, FALSE, NULL, FALSE);
      pDirInfo = (PFILE_DIRECTORY_INFORMATION)buffer;

      if (status == STATUS_NO_MORE_FILES) {
        break;
      } else if (status != STATUS_SUCCESS) {
        printf("Error querying directory: %x\n", status);
        return 1;
      } else {
        continue;
      }
    }

    pDirInfo = (PFILE_DIRECTORY_INFORMATION)((LPBYTE)pDirInfo +
                                             pDirInfo->NextEntryOffset);
  }

  CloseHandle(hFile);
  return 0;
}

#define FileBothDirectoryInformation static_cast<FILE_INFORMATION_CLASS>(3)

int main_using_file_both_information(int argc, char *argv[]) {
  if (argc != 2) {
    printf("Usage: ntquery <filename>\n");
    return 1;
  }

  auto *NtQueryDirectoryFile = (NTSTATUS(WINAPI *)(
      HANDLE, HANDLE, PVOID, PVOID, PVOID, PVOID, DWORD, FILE_INFORMATION_CLASS,
      BOOLEAN, PVOID, BOOLEAN))GetProcAddress(GetModuleHandle("ntdll.dll"),
                                              "NtQueryDirectoryFile");

  if (NtQueryDirectoryFile == NULL) {
    printf("Error getting NtQueryDirectoryFile\n");
    return 1;
  }

  // open the current working directory using NT API
  HANDLE hFile = CreateFile(argv[1], GENERIC_READ, FILE_SHARE_READ, NULL,
                            OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);

  // use NtQueryDirectoryFile
  char buffer[64096];

  IO_STATUS_BLOCK ioStatusBlock;
  NTSTATUS status = NtQueryDirectoryFile(
      hFile, NULL, NULL, NULL, &ioStatusBlock, buffer, sizeof(buffer),
      FileBothDirectoryInformation, FALSE, NULL, FALSE);
  if (status != STATUS_SUCCESS) {
    printf("Error querying directory\n");
    return 1;
  }

  PFILE_BOTH_DIR_INFORMATION pDirInfo = (PFILE_BOTH_DIR_INFORMATION)buffer;
  while (TRUE) {
    printf("%S\n", pDirInfo->FileName);
    if (pDirInfo->NextEntryOffset == 0) {
      // if no more entries, continue to next query directory call
      status = NtQueryDirectoryFile(
          hFile, NULL, NULL, NULL, &ioStatusBlock, buffer, sizeof(buffer),
          FileBothDirectoryInformation, FALSE, NULL, FALSE);
      pDirInfo = (PFILE_BOTH_DIR_INFORMATION)buffer;

      if (status == STATUS_NO_MORE_FILES) {
        break;
      } else if (status != STATUS_SUCCESS) {
        printf("Error querying directory: %x\n", status);
        return 1;
      } else {
        continue;
      }
    }

    pDirInfo = (PFILE_BOTH_DIR_INFORMATION)((LPBYTE)pDirInfo +
                                            pDirInfo->NextEntryOffset);
  }

  CloseHandle(hFile);
  return 0;
}

int main_using_findfirstfile_ex(int argc, char *argv[]) {
  if (argc != 2) {
    printf("Usage: ntquery <filename>\n");
    return 1;
  }

  // open the current working directory using NT API
  HANDLE hFile = CreateFile(argv[1], GENERIC_READ, FILE_SHARE_READ, NULL,
                            OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);

  char buffer[64096];

  WIN32_FIND_DATA findData;
  HANDLE hFind = FindFirstFileEx(argv[1], FindExInfoBasic, &findData,
                                 FindExSearchNameMatch, NULL, 0);
  if (hFind == INVALID_HANDLE_VALUE) {
    printf("Error querying directory\n");
    return 1;
  }

  do {
    char szPath[MAX_PATH];

    printf("%s\n", findData.cFileName);
  } while (FindNextFile(hFind, &findData));

  FindClose(hFind);
  return 0;
}

int main(int argc, char *argv[]) {
  return main_using_findfirstfile_ex(argc, argv);
}